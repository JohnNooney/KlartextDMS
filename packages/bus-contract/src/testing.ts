/**
 * In-memory test harness for the Bus (issue #24): a linked pair of fake
 * endpoints with `postMessage` sinks and `MessageEvent`-emitting sources,
 * synchronous delivery. App Bus adapters take an injected `{ source, sink }`,
 * so unit tests never touch `window`.
 *
 * Delivery is faithful to `window.postMessage` between two origins:
 * - `data` is structured-cloned; `Transferable`s in the transfer list detach.
 * - `event.origin` is the sender's origin; `event.source` is the peer window
 *   as the receiver knows it (the sink the receiver itself posts to).
 * - a `targetOrigin` that is neither the peer's origin nor `'*'` drops the
 *   message, like the real Bus.
 */

import type {
  GuestAdapter,
  GuestAdapterContext,
  HostAdapter,
  HostAdapterContext,
} from './conformance.js';
import {
  isBusMessage,
  isExtractionError,
  JOB_RESULT_TIMEOUT_MS,
  JOB_START_TIMEOUT_MS,
  SESSION_ACK_TIMEOUT_MS,
} from './messages.js';
import { NO_SESSION } from './envelope.js';
import type { BusEnd, BusMessageEvent, BusMessageListener, BusSink, BusSource } from './endpoints.js';
import type { ExtractionCandidate } from './extraction.js';
import type {
  ExtractionError,
  ExtractDocumentPayload,
  JobDocument,
  Session,
} from './messages.js';

// The endpoint types live at the contract root (endpoints.ts); re-exported
// here so existing `@klartext/bus-contract/testing` imports keep working.
export type { BusEnd, BusMessageEvent, BusMessageListener, BusSink, BusSource };

export interface LinkedBusPair {
  readonly host: BusEnd;
  readonly guest: BusEnd;
}

export interface LinkedBusPairOptions {
  /** Defaults are the dev Peer Origins (issue #7). */
  hostOrigin?: string;
  guestOrigin?: string;
}

class FakeBusSource implements BusSource {
  private readonly listeners = new Set<BusMessageListener>();

  addEventListener(type: 'message', listener: BusMessageListener): void {
    if (type === 'message') this.listeners.add(listener);
  }

  removeEventListener(type: 'message', listener: BusMessageListener): void {
    if (type === 'message') this.listeners.delete(listener);
  }

  emit(event: BusMessageEvent): void {
    for (const listener of [...this.listeners]) listener(event);
  }
}

class FakeBusSink implements BusSink {
  constructor(
    private readonly target: FakeBusSource,
    private readonly senderOrigin: string,
    private readonly peerOrigin: string,
    private readonly receiverSink: () => BusSink,
  ) {}

  postMessage(data: unknown, targetOrigin: string, transfer?: Transferable[]): void {
    if (targetOrigin !== '*' && targetOrigin !== this.peerOrigin) return;
    const cloned = structuredClone(data, { transfer: transfer ?? [] });
    this.target.emit({ data: cloned, origin: this.senderOrigin, source: this.receiverSink() });
  }
}

export function createLinkedBusPair(options: LinkedBusPairOptions = {}): LinkedBusPair {
  const hostOrigin = options.hostOrigin ?? 'http://localhost:4200';
  const guestOrigin = options.guestOrigin ?? 'http://localhost:5173';

  const hostSource = new FakeBusSource();
  const guestSource = new FakeBusSource();
  let hostSink: BusSink;
  let guestSink: BusSink;
  hostSink = new FakeBusSink(guestSource, hostOrigin, guestOrigin, () => guestSink);
  guestSink = new FakeBusSink(hostSource, guestOrigin, hostOrigin, () => hostSink);

  return {
    host: { source: hostSource, sink: hostSink },
    guest: { source: guestSource, sink: guestSink },
  };
}

// ---------------------------------------------------------------------------
// Loopback reference adapters: minimal protocol-correct Host and Guest used by
// the package's own conformance run, and available to apps before their real
// adapters exist.
// ---------------------------------------------------------------------------

const AI_UNAVAILABLE: ExtractionError = {
  code: 'AI_UNAVAILABLE',
  message: 'The document assistant is not responding.',
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
 * Minimal protocol-correct Host adapter over injected `{source, sink}`:
 * buffers the Session until `GUEST_READY`, runs one Extraction Job at a time
 * with the 10 s/120 s watchdogs, discards stale `sessionId`/`jobId` replies,
 * resends the Session and re-issues the in-flight job on a Guest reload.
 */
export function createLoopbackHostAdapter(ctx: HostAdapterContext): HostAdapter {
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
        }
        break;
      }
      case 'AI_PROCESSING_SUCCESS': {
        const { jobId, extraction } = msg.payload;
        if (activeJob && activeJob.acknowledged && jobId === activeJob.jobId) {
          settleJob(null, extraction);
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

/**
 * Minimal protocol-correct Guest adapter: announces `GUEST_READY` on mount,
 * acks every `INIT_SESSION`, and answers `EXTRACT_DOCUMENT` with an immediate
 * `AI_PROCESSING_STARTED` followed by the result of `ctx.runJob`.
 */
export function createLoopbackGuestAdapter(ctx: GuestAdapterContext): GuestAdapter {
  const post = (type: string, sessionId: string, payload: unknown): void => {
    ctx.sink.postMessage({ v: 1, type, sessionId, payload }, ctx.peerOrigin);
  };

  const onMessage = (event: BusMessageEvent): void => {
    if (event.origin !== ctx.peerOrigin || event.source !== ctx.sink) return;
    // Unknown types are ignored (forward compat) — isBusMessage filters them.
    if (!isBusMessage(event.data)) return;
    const msg = event.data;
    switch (msg.type) {
      case 'INIT_SESSION': {
        post('SESSION_ACK', msg.sessionId, {});
        ctx.probe.sessionApplied(msg.payload);
        break;
      }
      case 'EXTRACT_DOCUMENT': {
        const job = msg.payload;
        post('AI_PROCESSING_STARTED', NO_SESSION, { jobId: job.jobId });
        void ctx.runJob(job).then(
          (extraction) => post('AI_PROCESSING_SUCCESS', NO_SESSION, { jobId: job.jobId, extraction }),
          (err: unknown) =>
            post('AI_PROCESSING_ERROR', NO_SESSION, {
              jobId: job.jobId,
              error: isExtractionError(err)
                ? err
                : { code: 'UNKNOWN', message: 'Extraction failed.', retryable: true },
            }),
        );
        break;
      }
      default:
        break; // Guest→Host types arriving here are ignored
    }
  };

  ctx.source.addEventListener('message', onMessage);

  return {
    mount(): void {
      post('GUEST_READY', NO_SESSION, {});
    },
    requestRetry(documentId: string): void {
      post('RETRY_EXTRACTION', NO_SESSION, { documentId });
    },
    dispose(): void {
      ctx.source.removeEventListener('message', onMessage);
    },
  };
}
