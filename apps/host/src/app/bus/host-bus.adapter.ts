import { InjectionToken } from '@angular/core';
import {
  JOB_RESULT_TIMEOUT_MS,
  JOB_START_TIMEOUT_MS,
  NO_SESSION,
  SESSION_ACK_TIMEOUT_MS,
  isBusMessage,
  isExtractionCandidate,
} from '@klartext/bus-contract';
import type {
  BusMessageEvent,
  ExtractionCandidate,
  ExtractionError,
  ExtractDocumentPayload,
  JobDocument,
  Session,
} from '@klartext/bus-contract';
import type {
  HostAdapter,
  HostAdapterContext,
  HostProbe,
} from '@klartext/bus-contract/conformance';

/**
 * How the Host learns Bus outcomes. `HostProbe` is the conformance-suite
 * surface; the optional hooks are the app-side observability seams (issue #31):
 * `jobStarted`/`jobFailedFor` carry the job's Document (which the `HostProbe`
 * signatures don't), and `retryRequested` lets the app own the re-enqueue —
 * it fetches fresh bytes and clears the failure record, work the adapter
 * can't do. Returning `true` suppresses the adapter's own job-table re-queue.
 */
export interface HostBusProbe extends HostProbe {
  onGuestReady?(): void;
  /** STARTED acked a dispatched job — it now runs under the result watchdog. */
  jobStarted?(jobId: string, document: JobDocument): void;
  /** Fired alongside `HostProbe.jobFailed` with the job's Document. */
  jobFailedFor?(jobId: string, document: JobDocument, error: ExtractionError): void;
  /** RETRY_EXTRACTION arrived; return `true` when the app owns the re-enqueue. */
  retryRequested?(documentId: string): boolean;
}

export interface HostBusContext extends Omit<HostAdapterContext, 'probe'> {
  probe: HostBusProbe;
}

export type HostBusAdapterFactory = (ctx: HostBusContext) => HostAdapter;

/** DI seam for the adapter: tests substitute a capturing stub factory. */
export const HOST_BUS_ADAPTER_FACTORY = new InjectionToken<HostBusAdapterFactory>(
  'HOST_BUS_ADAPTER_FACTORY',
  { providedIn: 'root', factory: () => createHostBusAdapter },
);

const AI_UNAVAILABLE: ExtractionError = {
  code: 'AI_UNAVAILABLE',
  message: 'The document assistant is not responding.',
  retryable: true,
};

const INVALID_EXTRACTION: ExtractionError = {
  code: 'INVALID_EXTRACTION',
  message: 'The document could not be analyzed.',
  retryable: true,
};

interface QueuedJob {
  document: JobDocument;
  bytes: ArrayBuffer;
}

interface ActiveJob extends QueuedJob {
  jobId: string;
  acknowledged: boolean;
  watchdog: ReturnType<typeof setTimeout> | undefined;
}

/**
 * The Host's Bus adapter (issue #25): the production counterpart of the
 * package's loopback reference, over injected `{ source, sink }` so unit
 * tests never touch `window` — in the app, `source` wraps `window` message
 * events and `sink` is the Guest iframe's `contentWindow`.
 *
 * Buffers the current Session until `GUEST_READY`, runs one Extraction Job
 * at a time under the 10 s/10 s/120 s watchdogs, discards replies for a
 * stale `sessionId`/`jobId`, and on a Guest reload resends the Session and
 * re-issues the in-flight job under a fresh `jobId`.
 */
export function createHostBusAdapter(ctx: HostBusContext): HostAdapter {
  let guestReady = false;
  let sessionSeq = 0;
  let jobSeq = 0;
  let currentSession: Session | null = null;
  let sessionAckTimer: ReturnType<typeof setTimeout> | null = null;
  const knownDocuments = new Map<string, QueuedJob>();
  const queue: QueuedJob[] = [];
  let activeJob: ActiveJob | null = null;

  const failSession = (): void => {
    if (currentSession) ctx.probe.sessionFailed(currentSession.sessionId, AI_UNAVAILABLE);
  };

  const sendSession = (): void => {
    if (!currentSession) return;
    if (sessionAckTimer !== null) clearTimeout(sessionAckTimer);
    ctx.sink.postMessage(
      { v: 1, type: 'INIT_SESSION', sessionId: currentSession.sessionId, payload: currentSession },
      ctx.peerOrigin,
    );
    sessionAckTimer = setTimeout(failSession, SESSION_ACK_TIMEOUT_MS);
  };

  const dispatchJob = (job: QueuedJob): void => {
    const jobId = `job_${++jobSeq}`;
    // Keep a copy: transferring `bytes` detaches the buffer Host-side (ADR 0002).
    const outbound = job.bytes.slice(0);
    const payload: ExtractDocumentPayload = { jobId, document: job.document, bytes: outbound };
    const active: ActiveJob = { ...job, jobId, acknowledged: false, watchdog: undefined };
    // The active job must exist before posting: delivery is synchronous, so
    // the Guest's AI_PROCESSING_STARTED ack arrives inside this call.
    activeJob = active;
    ctx.sink.postMessage(
      { v: 1, type: 'EXTRACT_DOCUMENT', sessionId: NO_SESSION, payload },
      ctx.peerOrigin,
      [outbound],
    );
    if (!active.acknowledged) {
      active.watchdog = setTimeout(() => settleJob(AI_UNAVAILABLE), JOB_START_TIMEOUT_MS);
    }
  };

  const pumpQueue = (): void => {
    if (!guestReady || activeJob !== null || queue.length === 0) return;
    dispatchJob(queue.shift()!);
  };

  const settleJob = (error: ExtractionError | null, extraction?: ExtractionCandidate): void => {
    const job = activeJob;
    if (job === null) return;
    activeJob = null;
    clearTimeout(job.watchdog);
    if (error) {
      ctx.probe.jobFailed(job.jobId, error);
      ctx.probe.jobFailedFor?.(job.jobId, job.document, error);
    } else {
      ctx.probe.jobSucceeded(job.jobId, extraction!);
      // If the finished job is for the open Document, resend INIT_SESSION so
      // the panel updates without the Guest reloading (issue #7, amended).
      if (currentSession && currentSession.documentId === extraction!.documentId) {
        currentSession = {
          ...currentSession,
          sessionId: `sess_${++sessionSeq}`,
          extraction: {
            ...extraction!,
            createdAt: { seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 },
          },
          extractionState: 'none',
        };
        sendSession();
      }
    }
    pumpQueue();
  };

  const onMessage = (event: BusMessageEvent): void => {
    if (event.origin !== ctx.peerOrigin || event.source !== ctx.sink) return;
    // Unknown types are ignored (forward compat) — isBusMessage filters them.
    if (!isBusMessage(event.data)) return;
    const msg = event.data;
    switch (msg.type) {
      case 'GUEST_READY': {
        guestReady = true;
        ctx.probe.onGuestReady?.();
        // A fresh sessionId per send (issue #31): a late SESSION_ACK from the
        // old Guest instance must never satisfy the resent Session's watchdog.
        if (currentSession) {
          currentSession = { ...currentSession, sessionId: `sess_${++sessionSeq}` };
        }
        sendSession();
        if (activeJob !== null) {
          // Re-issue the in-flight job under a fresh jobId; stale results are discarded.
          clearTimeout(activeJob.watchdog);
          queue.unshift({ document: activeJob.document, bytes: activeJob.bytes });
          activeJob = null;
        }
        pumpQueue();
        break;
      }
      case 'SESSION_ACK': {
        if (currentSession && msg.sessionId === currentSession.sessionId) {
          if (sessionAckTimer !== null) clearTimeout(sessionAckTimer);
          sessionAckTimer = null;
        }
        break;
      }
      case 'AI_PROCESSING_STARTED': {
        const { jobId } = msg.payload;
        if (activeJob && !activeJob.acknowledged && jobId === activeJob.jobId) {
          activeJob.acknowledged = true;
          clearTimeout(activeJob.watchdog);
          activeJob.watchdog = setTimeout(() => settleJob(AI_UNAVAILABLE), JOB_RESULT_TIMEOUT_MS);
          ctx.probe.jobStarted?.(jobId, activeJob.document);
        }
        break;
      }
      case 'AI_PROCESSING_SUCCESS': {
        const { jobId, extraction } = msg.payload;
        if (activeJob && activeJob.acknowledged && jobId === activeJob.jobId) {
          // The Host validates before persisting (issue #31, #15): a partial,
          // schema-invalid, or foreign-Document Extraction is a job failure,
          // never a stored record or a displayed Session.
          settleJob(
            isExtractionCandidate(extraction) &&
              extraction.documentId === activeJob.document.documentId
              ? null
              : INVALID_EXTRACTION,
            extraction,
          );
        }
        break;
      }
      case 'AI_PROCESSING_ERROR': {
        const { jobId, error } = msg.payload;
        if (activeJob && activeJob.acknowledged && jobId === activeJob.jobId) {
          settleJob(error);
        }
        break;
      }
      case 'RETRY_EXTRACTION': {
        const { documentId } = msg.payload;
        // The app may own the re-enqueue (clears the failure record, refetches
        // bytes — also the only path for a Document this session never queued).
        if (ctx.probe.retryRequested?.(documentId)) break;
        const known = knownDocuments.get(documentId);
        if (known) {
          queue.push(known);
          pumpQueue();
        }
        break;
      }
      default:
        break; // Host→Guest types arriving here are ignored
    }
  };

  ctx.source.addEventListener('message', onMessage);

  return {
    openSession(session: Session): void {
      currentSession = session;
      if (guestReady) sendSession();
    },
    requestExtraction(document: JobDocument, bytes: ArrayBuffer): void {
      knownDocuments.set(document.documentId, { document, bytes });
      queue.push({ document, bytes });
      pumpQueue();
    },
    cancelJobs(documentId: string): void {
      knownDocuments.delete(documentId);
      for (let i = queue.length - 1; i >= 0; i--) {
        if (queue[i]!.document.documentId === documentId) queue.splice(i, 1);
      }
      if (activeJob && activeJob.document.documentId === documentId) {
        // Dropping the active job orphans its jobId: a late result no longer
        // matches and is discarded. The queue advances to the next Document.
        clearTimeout(activeJob.watchdog);
        activeJob = null;
        pumpQueue();
      }
    },
    dispose(): void {
      ctx.source.removeEventListener('message', onMessage);
      if (sessionAckTimer !== null) clearTimeout(sessionAckTimer);
      if (activeJob) clearTimeout(activeJob.watchdog);
    },
  };
}
