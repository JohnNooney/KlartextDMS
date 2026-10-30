import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Envelope } from './envelope.js';
import { isEnvelope } from './messages.js';
import { createLinkedBusPair, type BusSink, type BusSource } from './testing.js';
import { goldenFixtureMessages } from './fixtures.js';
import type {
  ActionItemDoneRequest,
  ActionItemStates,
  ExtractionCandidate,
  ExtractionError,
  GuestShowPagePayload,
  JobDocument,
  ExtractDocumentPayload,
  PanelPresentation,
  ReminderRequest,
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
  /**
   * GUEST_SHOW_PAGE arrived for the current Session (issue #78): `page` is
   * an integer ≥ 1; a non-string `quote` or non-boolean `critical` is
   * stripped rather than killing the request. The `1..pageCount` range check
   * is the app's — only it knows the open Document's page count.
   */
  pageRequested(request: GuestShowPagePayload): void;
  /**
   * GUEST_EXPAND_PANEL arrived for the current Session (issue #79): a
   * jump-bar tap in the sheet asks the Host to raise it — the Guest can't
   * reach its own frame's detent. Fire-and-forget, no payload to vet.
   */
  panelExpandRequested(): void;
  /**
   * GUEST_CREATE_REMINDER arrived for the current Session (issue #122):
   * `documentId` is the Session's Document — the envelope carries only the
   * Action Item's id, wire-vetted to a non-empty string. Fire-and-forget:
   * the app resolves the item from `extractionsByDocId` and owns the
   * Reminder export; Klartext never tracks it.
   */
  reminderRequested(request: ReminderRequest): void;
  /**
   * GUEST_SET_ACTION_ITEM_DONE arrived for the current Session (issue #144):
   * `documentId` is the Session's Document — the envelope carries only the
   * Action Item's id and the wanted state, wire-vetted. The app resolves the
   * item from `extractionsByDocId`, owns the write, and answers with an
   * `ACTION_ITEM_STATES` push — also on failure, to roll back the Guest's
   * optimistic state.
   */
  actionItemDoneRequested(request: ActionItemDoneRequest): void;
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
  /**
   * Drop every queued or in-flight Extraction Job for a Document being
   * deleted (issue #16): queued entries never dispatch, a late result for the
   * in-flight job is discarded, and RETRY_EXTRACTION no longer re-queues it.
   */
  cancelJobs(documentId: string): void;
  /**
   * The frame's presentation changed (issue #77): the Host's reader crossed
   * the mobile breakpoint, or the adapter is (re)asserting the mode ahead of
   * the Guest's readiness — buffered until `GUEST_READY`, sent again on each
   * crossing, and resent when the Guest reloads.
   */
  setPresentation(mode: PanelPresentation): void;
  /**
   * Pushes the open Document's authoritative Done map (issue #144):
   * `ACTION_ITEM_STATES` under the current Session — after every write
   * (including a failed one, which rolls back the Guest's optimistic state)
   * and on Host-side changes while the Document is open. Silent without a
   * Session — the next INIT_SESSION carries the map anyway.
   */
  pushActionItemStates(states: ActionItemStates): void;
  dispose(): void;
}

/** How the suite observes Guest adapter outcomes. */
export interface GuestProbe {
  sessionApplied(session: Session): void;
  /** A `PANEL_PRESENTATION` with a valid `mode` was applied (issue #77). */
  presentationApplied(mode: PanelPresentation): void;
  /**
   * An `ACTION_ITEM_STATES` push with a wire-vetted `states` map was applied
   * (issue #144): the authoritative Done map for the open Document — it
   * replaces the local map wholesale, optimistic marks included.
   */
  actionItemStatesApplied(states: ActionItemStates): void;
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
  /**
   * A Key Takeaway row carrying a `page` was selected (issue #78):
   * fire-and-forget `GUEST_SHOW_PAGE` under the current Session — no reply,
   * no watchdog.
   */
  showPage(request: GuestShowPagePayload): void;
  /**
   * A jump-bar segment was tapped while the sheet may sit at peek (issue
   * #79): fire-and-forget `GUEST_EXPAND_PANEL` under the current Session —
   * the Host raises a peeking sheet to half and ignores it everywhere else.
   */
  expandPanel(): void;
  /**
   * An Action Item's "Add reminder" was tapped (issue #122):
   * fire-and-forget `GUEST_CREATE_REMINDER` under the current Session — no
   * reply, no watchdog, and silent while no Session exists.
   */
  createReminder(actionItemId: string): void;
  /**
   * An Action Item's "Mark done" check was toggled (issue #144):
   * fire-and-forget `GUEST_SET_ACTION_ITEM_DONE` under the current Session —
   * the Guest has already applied the mark optimistically; the Host's
   * `ACTION_ITEM_STATES` push confirms or rolls it back. Silent while no
   * Session exists.
   */
  setActionItemDone(actionItemId: string, done: boolean): void;
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
      hostProbe = {
        sessionFailed: vi.fn(),
        jobSucceeded: vi.fn(),
        jobFailed: vi.fn(),
        pageRequested: vi.fn(),
        panelExpandRequested: vi.fn(),
        reminderRequested: vi.fn(),
        actionItemDoneRequested: vi.fn(),
      };
      guestProbe = {
        sessionApplied: vi.fn(),
        presentationApplied: vi.fn(),
        actionItemStatesApplied: vi.fn(),
      };
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

    it('cancelJobs drops a queued job for the Document — it never dispatches', async () => {
      const host = makeHost();
      const guest = makeGuest();
      guest.mount();
      host.requestExtraction(document, new ArrayBuffer(1));
      host.requestExtraction({ ...document, documentId: 'doc-b' }, new ArrayBuffer(1));
      expect(envelopesOf(wireToGuest, 'EXTRACT_DOCUMENT')).toHaveLength(1);

      host.cancelJobs('doc-b');
      jobDeferreds[0]!.resolve(extraction);
      await flush();
      expect(envelopesOf(wireToGuest, 'EXTRACT_DOCUMENT')).toHaveLength(1);
    });

    it('cancelJobs drops the in-flight job: late results discarded, the queue advances', async () => {
      const host = makeHost();
      const guest = makeGuest();
      guest.mount();
      host.requestExtraction(document, new ArrayBuffer(1));
      host.requestExtraction({ ...document, documentId: 'doc-b' }, new ArrayBuffer(1));
      const firstJobId = (
        envelopesOf(wireToGuest, 'EXTRACT_DOCUMENT')[0]!.payload as ExtractDocumentPayload
      ).jobId;

      host.cancelJobs(document.documentId);
      const dispatched = envelopesOf(wireToGuest, 'EXTRACT_DOCUMENT');
      expect(dispatched).toHaveLength(2);
      expect((dispatched[1]!.payload as ExtractDocumentPayload).document.documentId).toBe(
        'doc-b',
      );

      // A late result for the cancelled jobId is discarded.
      injectToHost({
        v: 1,
        type: 'AI_PROCESSING_SUCCESS',
        sessionId: '',
        payload: { jobId: firstJobId, extraction },
      });
      await flush();
      expect(hostProbe.jobSucceeded).not.toHaveBeenCalled();
    });

    it('cancelJobs forgets the Document: RETRY_EXTRACTION no longer re-queues it', async () => {
      const host = makeHost();
      const guest = makeGuest();
      guest.mount();
      host.requestExtraction(document, new ArrayBuffer(1));
      host.cancelJobs(document.documentId);
      await flush();

      guest.requestRetry(document.documentId);
      expect(envelopesOf(wireToHost, 'RETRY_EXTRACTION')).toHaveLength(1);
      await flush();
      expect(envelopesOf(wireToGuest, 'EXTRACT_DOCUMENT')).toHaveLength(1);
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

    it('carries a takeaway row selection to the Host: GUEST_SHOW_PAGE under the current Session (issue #78)', () => {
      const host = makeHost();
      const guest = makeGuest();
      guest.mount();
      host.openSession(session);

      const request = {
        page: 3,
        quote: 'Die Kündigung bedarf der Schriftform. Die Kündigungsfrist beträgt drei Monate.',
        critical: true,
      };
      guest.showPage(request);

      expect(envelopesOf(wireToHost, 'GUEST_SHOW_PAGE')).toEqual([
        { v: 1, type: 'GUEST_SHOW_PAGE', sessionId: session.sessionId, payload: request },
      ]);
      expect(hostProbe.pageRequested).toHaveBeenCalledWith(request);
    });

    it('a Session-bound message never goes out without a Session — showPage before INIT_SESSION is silent', () => {
      makeHost();
      const guest = makeGuest();
      guest.showPage({ page: 2 });
      expect(envelopesOf(wireToHost, 'GUEST_SHOW_PAGE')).toEqual([]);
      expect(hostProbe.pageRequested).not.toHaveBeenCalled();
    });

    it('the Host ignores GUEST_SHOW_PAGE for a stale sessionId', () => {
      const host = makeHost();
      host.openSession(session);
      injectToHost({
        v: 1,
        type: 'GUEST_SHOW_PAGE',
        sessionId: 'sess-stale',
        payload: { page: 2 },
      });
      expect(hostProbe.pageRequested).not.toHaveBeenCalled();
    });

    it('the Host ignores a non-integer, non-positive, or missing page, whatever the extras', () => {
      const host = makeHost();
      host.openSession(session);
      for (const payload of [{ page: 2.5 }, { page: '2' }, { page: 0 }, { page: -2 }, {}, null, 'two']) {
        injectToHost({ v: 1, type: 'GUEST_SHOW_PAGE', sessionId: session.sessionId, payload });
      }
      expect(hostProbe.pageRequested).not.toHaveBeenCalled();
    });

    it('a malformed quote or critical is stripped, not fatal — the page still lands', () => {
      const host = makeHost();
      host.openSession(session);
      injectToHost({
        v: 1,
        type: 'GUEST_SHOW_PAGE',
        sessionId: session.sessionId,
        payload: { page: 3, quote: 7, critical: 'yes' },
      });
      expect(hostProbe.pageRequested).toHaveBeenCalledWith({
        page: 3,
        quote: undefined,
        critical: undefined,
      });
    });

    it('carries a jump-bar tap to the Host: GUEST_EXPAND_PANEL under the current Session (issue #79)', () => {
      const host = makeHost();
      const guest = makeGuest();
      guest.mount();
      host.openSession(session);

      guest.expandPanel();

      expect(envelopesOf(wireToHost, 'GUEST_EXPAND_PANEL')).toEqual([
        { v: 1, type: 'GUEST_EXPAND_PANEL', sessionId: session.sessionId, payload: {} },
      ]);
      expect(hostProbe.panelExpandRequested).toHaveBeenCalledOnce();
    });

    it('expandPanel before INIT_SESSION is silent', () => {
      makeHost();
      const guest = makeGuest();
      guest.expandPanel();
      expect(envelopesOf(wireToHost, 'GUEST_EXPAND_PANEL')).toEqual([]);
      expect(hostProbe.panelExpandRequested).not.toHaveBeenCalled();
    });

    it('the Host ignores GUEST_EXPAND_PANEL for a stale sessionId', () => {
      const host = makeHost();
      host.openSession(session);
      injectToHost({
        v: 1,
        type: 'GUEST_EXPAND_PANEL',
        sessionId: 'sess-stale',
        payload: {},
      });
      expect(hostProbe.panelExpandRequested).not.toHaveBeenCalled();
    });

    it('carries an Add-reminder tap to the Host: GUEST_CREATE_REMINDER under the current Session (issue #122)', () => {
      const host = makeHost();
      const guest = makeGuest();
      guest.mount();
      host.openSession(session);

      guest.createReminder('ai_3f9c2e7b1d4a58');

      expect(envelopesOf(wireToHost, 'GUEST_CREATE_REMINDER')).toEqual([
        {
          v: 1,
          type: 'GUEST_CREATE_REMINDER',
          sessionId: session.sessionId,
          payload: { actionItemId: 'ai_3f9c2e7b1d4a58' },
        },
      ]);
      // The adapter binds the Session's Document — the wire payload had none.
      expect(hostProbe.reminderRequested).toHaveBeenCalledWith({
        documentId: session.documentId,
        actionItemId: 'ai_3f9c2e7b1d4a58',
      });
    });

    it('createReminder before INIT_SESSION is silent', () => {
      makeHost();
      const guest = makeGuest();
      guest.createReminder('ai_3f9c2e7b1d4a58');
      expect(envelopesOf(wireToHost, 'GUEST_CREATE_REMINDER')).toEqual([]);
      expect(hostProbe.reminderRequested).not.toHaveBeenCalled();
    });

    it('the Host ignores GUEST_CREATE_REMINDER for a stale sessionId', () => {
      const host = makeHost();
      host.openSession(session);
      injectToHost({
        v: 1,
        type: 'GUEST_CREATE_REMINDER',
        sessionId: 'sess-stale',
        payload: { actionItemId: 'ai_3f9c2e7b1d4a58' },
      });
      expect(hostProbe.reminderRequested).not.toHaveBeenCalled();
    });

    it('the Host ignores a missing, empty, or non-string actionItemId', () => {
      const host = makeHost();
      host.openSession(session);
      for (const payload of [{}, { actionItemId: '' }, { actionItemId: 7 }, null, 'ai_9f']) {
        injectToHost({
          v: 1,
          type: 'GUEST_CREATE_REMINDER',
          sessionId: session.sessionId,
          payload,
        });
      }
      expect(hostProbe.reminderRequested).not.toHaveBeenCalled();
    });

    it('carries a mark-done toggle to the Host: GUEST_SET_ACTION_ITEM_DONE under the current Session (issue #144)', () => {
      const host = makeHost();
      const guest = makeGuest();
      guest.mount();
      host.openSession(session);

      guest.setActionItemDone('ai_3f9c2e7b1d4a58', true);

      expect(envelopesOf(wireToHost, 'GUEST_SET_ACTION_ITEM_DONE')).toEqual([
        {
          v: 1,
          type: 'GUEST_SET_ACTION_ITEM_DONE',
          sessionId: session.sessionId,
          payload: { actionItemId: 'ai_3f9c2e7b1d4a58', done: true },
        },
      ]);
      // The adapter binds the Session's Document — the wire payload had none.
      expect(hostProbe.actionItemDoneRequested).toHaveBeenCalledWith({
        documentId: session.documentId,
        actionItemId: 'ai_3f9c2e7b1d4a58',
        done: true,
      });
    });

    it('setActionItemDone before INIT_SESSION is silent', () => {
      makeHost();
      const guest = makeGuest();
      guest.setActionItemDone('ai_3f9c2e7b1d4a58', false);
      expect(envelopesOf(wireToHost, 'GUEST_SET_ACTION_ITEM_DONE')).toEqual([]);
      expect(hostProbe.actionItemDoneRequested).not.toHaveBeenCalled();
    });

    it('the Host ignores GUEST_SET_ACTION_ITEM_DONE for a stale sessionId', () => {
      const host = makeHost();
      host.openSession(session);
      injectToHost({
        v: 1,
        type: 'GUEST_SET_ACTION_ITEM_DONE',
        sessionId: 'sess-stale',
        payload: { actionItemId: 'ai_3f9c2e7b1d4a58', done: true },
      });
      expect(hostProbe.actionItemDoneRequested).not.toHaveBeenCalled();
    });

    it('the Host ignores a malformed GUEST_SET_ACTION_ITEM_DONE', () => {
      const host = makeHost();
      host.openSession(session);
      for (const payload of [
        {},
        { actionItemId: 'ai_9f' },
        { actionItemId: '', done: true },
        { actionItemId: 7, done: true },
        { actionItemId: 'ai_9f', done: 'yes' },
        null,
        'ai_9f',
      ]) {
        injectToHost({
          v: 1,
          type: 'GUEST_SET_ACTION_ITEM_DONE',
          sessionId: session.sessionId,
          payload,
        });
      }
      expect(hostProbe.actionItemDoneRequested).not.toHaveBeenCalled();
    });

    it('pushes the authoritative Done map to the Guest: ACTION_ITEM_STATES under the current Session (issue #144)', () => {
      const host = makeHost();
      const guest = makeGuest();
      guest.mount();
      host.openSession(session);

      const states: ActionItemStates = {
        ai_3f9c2e7b1d4a58: { doneAt: '2026-10-21T08:00:00.000Z', doneThrough: '2026-11-03' },
      };
      host.pushActionItemStates(states);

      expect(envelopesOf(wireToGuest, 'ACTION_ITEM_STATES')).toEqual([
        { v: 1, type: 'ACTION_ITEM_STATES', sessionId: session.sessionId, payload: { states } },
      ]);
      expect(guestProbe.actionItemStatesApplied).toHaveBeenCalledWith(states);
    });

    it('pushActionItemStates without a Session is silent — the next INIT_SESSION carries the map', () => {
      const host = makeHost();
      host.pushActionItemStates({ ai_9f: { doneAt: '2026-10-21T08:00:00.000Z' } });
      expect(envelopesOf(wireToGuest, 'ACTION_ITEM_STATES')).toEqual([]);
    });

    it('the Guest ignores a malformed ACTION_ITEM_STATES', () => {
      const host = makeHost();
      const guest = makeGuest();
      guest.mount();
      host.openSession(session);
      for (const payload of [
        {},
        { states: 'done' },
        { states: [] },
        { states: { ai_9f: 7 } },
        null,
        'states',
      ]) {
        injectToGuest({
          v: 1,
          type: 'ACTION_ITEM_STATES',
          sessionId: session.sessionId,
          payload,
        });
      }
      expect(guestProbe.actionItemStatesApplied).not.toHaveBeenCalled();
    });

    it('the Guest strips malformed entries from an ACTION_ITEM_STATES map', () => {
      const host = makeHost();
      const guest = makeGuest();
      guest.mount();
      host.openSession(session);
      injectToGuest({
        v: 1,
        type: 'ACTION_ITEM_STATES',
        sessionId: session.sessionId,
        payload: {
          states: {
            good: { doneAt: '2026-10-21T08:00:00.000Z' },
            bad: { doneThrough: '2026-11-03' },
          },
        },
      });
      expect(guestProbe.actionItemStatesApplied).toHaveBeenCalledWith({
        good: { doneAt: '2026-10-21T08:00:00.000Z' },
      });
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
      // A fresh sessionId per send — a stale SESSION_ACK must never satisfy
      // the resent Session's watchdog.
      expect(sessions.at(-1)!.sessionId).not.toBe(sessions.at(-2)!.sessionId);
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

    it('delivers the panel presentation once the Guest is ready, and on every crossing (issue #77)', () => {
      const host = makeHost();
      const guest = makeGuest();
      host.setPresentation('lane');
      // Presentation is per-frame state: buffered until GUEST_READY like the Session.
      expect(envelopesOf(wireToGuest, 'PANEL_PRESENTATION')).toEqual([]);
      guest.mount();
      expect(envelopesOf(wireToGuest, 'PANEL_PRESENTATION')).toEqual([
        { v: 1, type: 'PANEL_PRESENTATION', sessionId: '', payload: { mode: 'lane' } },
      ]);
      expect(guestProbe.presentationApplied).toHaveBeenCalledWith('lane');

      // A breakpoint crossing reports the new mode; re-asserting it does not.
      host.setPresentation('sheet');
      host.setPresentation('sheet');
      expect(envelopesOf(wireToGuest, 'PANEL_PRESENTATION')).toHaveLength(2);
      expect(guestProbe.presentationApplied).toHaveBeenLastCalledWith('sheet');
    });

    it('resends the presentation when the Guest reloads', () => {
      const host = makeHost();
      const guest = makeGuest();
      host.setPresentation('lane');
      guest.mount();
      guest.mount(); // iframe reloaded: GUEST_READY re-announced
      expect(envelopesOf(wireToGuest, 'PANEL_PRESENTATION')).toHaveLength(2);
    });

    it('the Guest ignores a presentation carrying an invalid mode', () => {
      const guest = makeGuest();
      guest.mount();
      injectToGuest({ v: 1, type: 'PANEL_PRESENTATION', sessionId: '', payload: { mode: 'drawer' } });
      injectToGuest({ v: 1, type: 'PANEL_PRESENTATION', sessionId: '', payload: {} });
      injectToGuest({ v: 1, type: 'PANEL_PRESENTATION', sessionId: '', payload: 'lane' });
      expect(guestProbe.presentationApplied).not.toHaveBeenCalled();
    });

    it('ignores envelopes with an unknown type on both sides', async () => {
      const host = makeHost();
      const guest = makeGuest();
      guest.mount();
      injectToHost({ v: 1, type: 'AUTH_TOKEN_REFRESHED', sessionId: '', payload: { authToken: 'x' } });
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
