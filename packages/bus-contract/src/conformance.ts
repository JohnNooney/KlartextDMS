import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Envelope } from './envelope.js';
import { isEnvelope } from './messages.js';
import { createLinkedBusPair, type BusSink, type BusSource } from './testing.js';
import { goldenFixtureMessages } from './fixtures.js';
import type {
  ExtractionCandidate,
  ExtractionError,
  JobDocument,
  ExtractDocumentPayload,
  Session,
} from './index.js';
import {
  JOB_RESULT_TIMEOUT_MS,
  JOB_START_TIMEOUT_MS,
  SESSION_ACK_TIMEOUT_MS,
} from './messages.js';

/**
 * Protocol conformance suite (issues #13, #24). Each app plugs its Bus
 * adapters in and runs this inside its own Vitest; the package's own run
 * passes it against the loopback adapters in `testing.ts`.
 *
 * The suite owns the wire: it creates a linked endpoint pair per test, taps
 * both directions, and can impersonate the peer by posting forged envelopes
 * straight onto the unused sink.
 */

/** How the suite observes Host adapter outcomes. */
export interface HostProbe {
  sessionFailed(sessionId: string, error: ExtractionError): void;
  jobSucceeded(jobId: string, extraction: ExtractionCandidate): void;
  jobFailed(jobId: string, error: ExtractionError): void;
}

export interface HostAdapterContext {
  source: BusSource;
  sink: BusSink;
  /** The Guest's origin — `targetOrigin` on sends, `event.origin` check on receives. */
  peerOrigin: string;
  probe: HostProbe;
}

export interface HostAdapter {
  /** User opened a Document: buffer or send INIT_SESSION. */
  openSession(session: Session): void;
  /** Enqueue an Extraction Job for a Document whose bytes the Host holds. */
  requestExtraction(document: JobDocument, bytes: ArrayBuffer): void;
  dispose(): void;
}

/** How the suite observes Guest adapter outcomes. */
export interface GuestProbe {
  sessionApplied(session: Session): void;
}

export interface GuestAdapterContext {
  source: BusSource;
  sink: BusSink;
  /** The Host's origin — `targetOrigin` on sends, `event.origin` check on receives. */
  peerOrigin: string;
  probe: GuestProbe;
  /**
   * The suite's stand-in for the AI provider: the adapter must call it after
   * emitting `AI_PROCESSING_STARTED`, then emit `AI_PROCESSING_SUCCESS` with
   * the resolved Extraction or `AI_PROCESSING_ERROR` when it rejects (with an
   * `ExtractionError`-shaped value).
   */
  runJob(job: ExtractDocumentPayload): Promise<ExtractionCandidate>;
}

export interface GuestAdapter {
  /** The iframe (re)mounted: the Guest (re)announces readiness. */
  mount(): void;
  /** User asked to retry an Extraction for a Document. */
  requestRetry(documentId: string): void;
  dispose(): void;
}

export interface ConformanceAdapters {
  createHost(ctx: HostAdapterContext): HostAdapter;
  createGuest(ctx: GuestAdapterContext): GuestAdapter;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

function defer<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Fake timers do not flush microtasks; this does. */
async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

function envelopesOf(wire: unknown[], type: string): Envelope<string, unknown>[] {
  return wire.filter(
    (d): d is Envelope<string, unknown> => isEnvelope(d) && d.type === type,
  );
}

export function runBusContractConformance(adapters: ConformanceAdapters): void {
  const HOST_ORIGIN = 'http://host.test';
  const GUEST_ORIGIN = 'http://guest.test';

  describe('Bus contract conformance', () => {
    let wireToGuest: unknown[];
    let wireToHost: unknown[];
    let hostProbe: HostProbe;
    let guestProbe: GuestProbe;
    let jobDeferreds: Deferred<ExtractionCandidate>[];
    let jobPayloads: ExtractDocumentPayload[];
    let disposers: Array<() => void>;
    let pair: ReturnType<typeof createLinkedBusPair>;

    function makeHost(): HostAdapter {
      const adapter = adapters.createHost({
        source: pair.host.source,
        sink: pair.host.sink,
        peerOrigin: GUEST_ORIGIN,
        probe: hostProbe,
      });
      disposers.push(adapter.dispose);
      return adapter;
    }

    function makeGuest(): GuestAdapter {
      const adapter = adapters.createGuest({
        source: pair.guest.source,
        sink: pair.guest.sink,
        peerOrigin: HOST_ORIGIN,
        probe: guestProbe,
        runJob: (job) => {
          jobPayloads.push(job);
          const d = defer<ExtractionCandidate>();
          jobDeferreds.push(d);
          return d.promise;
        },
      });
      disposers.push(adapter.dispose);
      return adapter;
    }

    /** Impersonate the peer by posting a forged envelope straight onto the wire. */
    function injectToHost(envelope: unknown): void {
      pair.guest.sink.postMessage(envelope, HOST_ORIGIN);
    }
    function injectToGuest(envelope: unknown): void {
      pair.host.sink.postMessage(envelope, GUEST_ORIGIN);
    }

    // Scenarios run against the golden fixtures: the Session without a stored
    // Extraction, a Job for the same Document, and the Extraction it yields.
    const fixtureSession = goldenFixtureMessages.INIT_SESSION.payload;
    const session: Session = { ...fixtureSession, extraction: null, extractionState: 'none' };
    const document: JobDocument = {
      ...goldenFixtureMessages.EXTRACT_DOCUMENT.payload.document,
      documentId: session.documentId,
    };
    const extraction: ExtractionCandidate = {
      ...goldenFixtureMessages.AI_PROCESSING_SUCCESS.payload.extraction,
      documentId: session.documentId,
    };

    beforeEach(() => {
      vi.useFakeTimers();
      pair = createLinkedBusPair({ hostOrigin: HOST_ORIGIN, guestOrigin: GUEST_ORIGIN });
      wireToGuest = [];
      wireToHost = [];
      pair.guest.source.addEventListener('message', (e) => wireToGuest.push(e.data));
      pair.host.source.addEventListener('message', (e) => wireToHost.push(e.data));
      hostProbe = { sessionFailed: vi.fn(), jobSucceeded: vi.fn(), jobFailed: vi.fn() };
      guestProbe = { sessionApplied: vi.fn() };
      jobDeferreds = [];
      jobPayloads = [];
      disposers = [];
    });

    afterEach(() => {
      for (const dispose of disposers) dispose();
      vi.useRealTimers();
    });

    it('handshakes: GUEST_READY, INIT_SESSION, SESSION_ACK echoing the sessionId', () => {
      const host = makeHost();
      const guest = makeGuest();
      guest.mount();
      expect(wireToHost).toContainEqual({ v: 1, type: 'GUEST_READY', sessionId: '', payload: {} });
      host.openSession(session);
      expect(envelopesOf(wireToGuest, 'INIT_SESSION')).toEqual([
        expect.objectContaining({ v: 1, sessionId: session.sessionId, payload: session }),
      ]);
      expect(envelopesOf(wireToHost, 'SESSION_ACK')).toEqual([
        expect.objectContaining({ sessionId: session.sessionId }),
      ]);
      expect(guestProbe.sessionApplied).toHaveBeenCalledWith(session);
    });

    it('buffers the pending Session until GUEST_READY arrives', () => {
      const host = makeHost();
      const guest = makeGuest();
      host.openSession(session);
      expect(envelopesOf(wireToGuest, 'INIT_SESSION')).toEqual([]);
      guest.mount();
      expect(envelopesOf(wireToGuest, 'INIT_SESSION')).toHaveLength(1);
      expect(envelopesOf(wireToHost, 'SESSION_ACK')).toHaveLength(1);
    });

    it('a Session carrying a stored Extraction starts no AI work', async () => {
      const host = makeHost();
      const guest = makeGuest();
      const stored = fixtureSession.extraction;
      guest.mount();
      host.openSession({ ...session, extraction: stored });
      await flush();
      expect(guestProbe.sessionApplied).toHaveBeenCalledWith(
        expect.objectContaining({ extraction: stored }),
      );
      expect(envelopesOf(wireToHost, 'AI_PROCESSING_STARTED')).toEqual([]);
      expect(envelopesOf(wireToGuest, 'EXTRACT_DOCUMENT')).toEqual([]);
    });

    it('runs the Extraction Job lifecycle: dispatch, immediate STARTED, SUCCESS', async () => {
      const host = makeHost();
      const guest = makeGuest();
      guest.mount();
      const bytes = new TextEncoder().encode('%PDF').buffer as ArrayBuffer;
      host.requestExtraction(document, bytes);

      const dispatched = envelopesOf(wireToGuest, 'EXTRACT_DOCUMENT');
      expect(dispatched).toHaveLength(1);
      const jobId = (dispatched[0]!.payload as ExtractDocumentPayload).jobId;
      expect(dispatched[0]!.sessionId).toBe('');

      const started = envelopesOf(wireToHost, 'AI_PROCESSING_STARTED');
      expect(started).toEqual([expect.objectContaining({ sessionId: '', payload: { jobId } })]);

      expect(jobPayloads[0]!.document).toEqual(document);
      jobDeferreds[0]!.resolve(extraction);
      await flush();

      expect(envelopesOf(wireToHost, 'AI_PROCESSING_SUCCESS')).toEqual([
        expect.objectContaining({ sessionId: '', payload: { jobId, extraction } }),
      ]);
      expect(hostProbe.jobSucceeded).toHaveBeenCalledWith(jobId, extraction);
    });

    it('reports job failure as AI_PROCESSING_ERROR carrying the error payload', async () => {
      const host = makeHost();
      const guest = makeGuest();
      guest.mount();
      host.requestExtraction(document, new ArrayBuffer(4));
      const jobId = (envelopesOf(wireToGuest, 'EXTRACT_DOCUMENT')[0]!.payload as ExtractDocumentPayload).jobId;

      const error: ExtractionError = { code: 'INVALID_EXTRACTION', message: 'Unreadable.', retryable: true };
      jobDeferreds[0]!.reject(error);
      await flush();

      expect(envelopesOf(wireToHost, 'AI_PROCESSING_ERROR')).toEqual([
        expect.objectContaining({ sessionId: '', payload: { jobId, error } }),
      ]);
      expect(hostProbe.jobFailed).toHaveBeenCalledWith(jobId, error);
    });

    it('runs one job at a time: the queue advances only when a job settles', async () => {
      const host = makeHost();
      const guest = makeGuest();
      guest.mount();
      host.requestExtraction(document, new ArrayBuffer(1));
      host.requestExtraction({ ...document, documentId: 'doc-b' }, new ArrayBuffer(1));
      expect(envelopesOf(wireToGuest, 'EXTRACT_DOCUMENT')).toHaveLength(1);

      jobDeferreds[0]!.resolve(extraction);
      await flush();
      const dispatched = envelopesOf(wireToGuest, 'EXTRACT_DOCUMENT');
      expect(dispatched).toHaveLength(2);
      expect((dispatched[1]!.payload as ExtractDocumentPayload).document.documentId).toBe('doc-b');
    });

    it('forwards RETRY_EXTRACTION as a fresh Extraction Job for the Document', async () => {
      const host = makeHost();
      const guest = makeGuest();
      guest.mount();
      host.requestExtraction(document, new ArrayBuffer(1));
      jobDeferreds[0]!.resolve(extraction);
      await flush();

      guest.requestRetry(document.documentId);
      expect(envelopesOf(wireToHost, 'RETRY_EXTRACTION')).toEqual([
        expect.objectContaining({ sessionId: '', payload: { documentId: document.documentId } }),
      ]);
      await flush();
      const dispatched = envelopesOf(wireToGuest, 'EXTRACT_DOCUMENT');
      expect(dispatched).toHaveLength(2);
      const reissued = dispatched[1]!.payload as ExtractDocumentPayload;
      expect(reissued.document.documentId).toBe(document.documentId);
      expect(reissued.jobId).not.toBe((dispatched[0]!.payload as ExtractDocumentPayload).jobId);
    });

    it('recovers a Guest reload: resends the Session and re-issues the job under a fresh jobId', async () => {
      const host = makeHost();
      const guest = makeGuest();
      guest.mount();
      host.openSession(session);
      host.requestExtraction(document, new ArrayBuffer(1));
      const firstJobId = (envelopesOf(wireToGuest, 'EXTRACT_DOCUMENT')[0]!.payload as ExtractDocumentPayload).jobId;

      guest.mount(); // iframe reloaded: GUEST_READY re-announced
      const sessions = envelopesOf(wireToGuest, 'INIT_SESSION');
      expect(sessions.at(-1)).toMatchObject({ payload: expect.objectContaining({ documentId: session.documentId }) });
      const jobs = envelopesOf(wireToGuest, 'EXTRACT_DOCUMENT');
      const reissued = jobs.at(-1)!.payload as ExtractDocumentPayload;
      expect(reissued.jobId).not.toBe(firstJobId);

      // A late result for the superseded jobId is discarded.
      injectToHost({ v: 1, type: 'AI_PROCESSING_SUCCESS', sessionId: '', payload: { jobId: firstJobId, extraction } });
      await flush();
      expect(hostProbe.jobSucceeded).not.toHaveBeenCalled();

      jobDeferreds.at(-1)!.resolve(extraction);
      await flush();
      expect(hostProbe.jobSucceeded).toHaveBeenCalledWith(reissued.jobId, extraction);
    });

    it('discards replies for a stale sessionId (a late SESSION_ACK does not cancel the watchdog)', () => {
      const host = makeHost();
      injectToHost({ v: 1, type: 'GUEST_READY', sessionId: '', payload: {} });
      host.openSession({ ...session, sessionId: 'sess-new' });
      injectToHost({ v: 1, type: 'SESSION_ACK', sessionId: 'sess-stale', payload: {} });
      vi.advanceTimersByTime(SESSION_ACK_TIMEOUT_MS);
      expect(hostProbe.sessionFailed).toHaveBeenCalledWith(
        'sess-new',
        expect.objectContaining({ code: 'AI_UNAVAILABLE' }),
      );
    });

    it('watchdog: no SESSION_ACK within 10 s of INIT_SESSION fails the Session', () => {
      const host = makeHost();
      injectToHost({ v: 1, type: 'GUEST_READY', sessionId: '', payload: {} });
      host.openSession(session);
      vi.advanceTimersByTime(SESSION_ACK_TIMEOUT_MS);
      expect(hostProbe.sessionFailed).toHaveBeenCalledWith(
        session.sessionId,
        expect.objectContaining({ code: 'AI_UNAVAILABLE', retryable: true }),
      );
    });

    it('watchdog: no AI_PROCESSING_STARTED within 10 s of EXTRACT_DOCUMENT fails the job', () => {
      const host = makeHost();
      injectToHost({ v: 1, type: 'GUEST_READY', sessionId: '', payload: {} });
      host.requestExtraction(document, new ArrayBuffer(1));
      const jobId = (envelopesOf(wireToGuest, 'EXTRACT_DOCUMENT')[0]!.payload as ExtractDocumentPayload).jobId;
      vi.advanceTimersByTime(JOB_START_TIMEOUT_MS);
      expect(hostProbe.jobFailed).toHaveBeenCalledWith(
        jobId,
        expect.objectContaining({ code: 'AI_UNAVAILABLE', retryable: true }),
      );
    });

    it('watchdog: no result within 120 s of STARTED fails the job and discards the late result', async () => {
      const host = makeHost();
      const guest = makeGuest();
      guest.mount();
      host.requestExtraction(document, new ArrayBuffer(1));
      const jobId = (envelopesOf(wireToGuest, 'EXTRACT_DOCUMENT')[0]!.payload as ExtractDocumentPayload).jobId;
      // STARTED arrived; now the job stalls.
      vi.advanceTimersByTime(JOB_RESULT_TIMEOUT_MS);
      expect(hostProbe.jobFailed).toHaveBeenCalledWith(
        jobId,
        expect.objectContaining({ code: 'AI_UNAVAILABLE', retryable: true }),
      );
      injectToHost({ v: 1, type: 'AI_PROCESSING_SUCCESS', sessionId: '', payload: { jobId, extraction } });
      await flush();
      expect(hostProbe.jobSucceeded).not.toHaveBeenCalled();
    });

    it('ignores envelopes with an unknown type on both sides', async () => {
      const host = makeHost();
      const guest = makeGuest();
      guest.mount();
      injectToHost({ v: 1, type: 'GUEST_SHOW_PAGE', sessionId: '', payload: { page: 2 } });
      injectToGuest({ v: 1, type: 'AUTH_TOKEN_REFRESHED', sessionId: session.sessionId, payload: { authToken: 'x' } });
      injectToHost('not even an envelope');
      wireToGuest.length = 0; // ignore the injected envelopes themselves; assert no reaction
      wireToHost.length = 0;
      await flush();
      vi.advanceTimersByTime(SESSION_ACK_TIMEOUT_MS + JOB_RESULT_TIMEOUT_MS);
      expect(wireToGuest).toEqual([]);
      expect(wireToHost).toEqual([]);
      expect(hostProbe.sessionFailed).not.toHaveBeenCalled();
      expect(hostProbe.jobFailed).not.toHaveBeenCalled();
      expect(guestProbe.sessionApplied).not.toHaveBeenCalled();
    });

    it('resends INIT_SESSION when the job for the open Document completes', async () => {
      const host = makeHost();
      const guest = makeGuest();
      guest.mount();
      host.openSession({ ...session, extractionState: 'running' });
      host.requestExtraction(document, new ArrayBuffer(1));
      jobDeferreds[0]!.resolve(extraction);
      await flush();

      const sessions = envelopesOf(wireToGuest, 'INIT_SESSION');
      expect(sessions.length).toBeGreaterThanOrEqual(2);
      const resent = sessions.at(-1)!;
      expect(resent.sessionId).not.toBe(session.sessionId);
      expect(resent.payload).toMatchObject({
        documentId: session.documentId,
        extraction: expect.objectContaining({ documentId: session.documentId }),
      });
    });
  });
}
