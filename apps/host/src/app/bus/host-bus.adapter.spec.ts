import { describe, expect, it, vi } from 'vitest';
import type {
  BusMessageEvent,
  BusMessageListener,
  BusSink,
  BusSource,
} from '@klartext/bus-contract';
import { goldenFixtureMessages } from '@klartext/bus-contract';
import { createHostBusAdapter } from './host-bus.adapter';
import type { HostBusProbe } from './host-bus.adapter';

const PEER_ORIGIN = 'http://guest.test';

class FakeSource implements BusSource {
  private listener: BusMessageListener | null = null;
  addEventListener(_type: 'message', listener: BusMessageListener): void {
    this.listener = listener;
  }
  removeEventListener(): void {
    this.listener = null;
  }
  emit(event: BusMessageEvent): void {
    this.listener?.(event);
  }
}

function setup() {
  const source = new FakeSource();
  const sink: BusSink = { postMessage: vi.fn() };
  const probe: Required<HostBusProbe> = {
    onGuestReady: vi.fn(),
    sessionFailed: vi.fn(),
    jobSucceeded: vi.fn(),
    jobFailed: vi.fn(),
    jobStarted: vi.fn(),
    jobFailedFor: vi.fn(),
    retryRequested: vi.fn(() => false),
    pageRequested: vi.fn(),
    panelExpandRequested: vi.fn(),
    reminderRequested: vi.fn(),
    actionItemDoneRequested: vi.fn(),
  };
  const adapter = createHostBusAdapter({ source, sink, peerOrigin: PEER_ORIGIN, probe });
  return { source, sink, probe, adapter };
}

const GUEST_READY = { v: 1, type: 'GUEST_READY', sessionId: '', payload: {} };

describe('HostBus adapter — receive-side checks', () => {
  it('ignores messages from an origin other than the Peer Origin', () => {
    const { source, sink, probe } = setup();
    source.emit({ data: GUEST_READY, origin: 'http://evil.test', source: sink });
    expect(probe.onGuestReady).not.toHaveBeenCalled();
    expect(sink.postMessage).not.toHaveBeenCalled();
  });

  it('ignores messages whose source is not the Guest iframe window', () => {
    const { source, sink, probe } = setup();
    const stranger: BusSink = { postMessage: vi.fn() };
    source.emit({ data: GUEST_READY, origin: PEER_ORIGIN, source: stranger });
    expect(probe.onGuestReady).not.toHaveBeenCalled();
    expect(sink.postMessage).not.toHaveBeenCalled();
  });

  it('ignores non-Envelope payloads without crashing', () => {
    const { source, sink, probe } = setup();
    for (const data of ['not an envelope', 42, null, { v: 2 }, { type: 'GUEST_READY' }]) {
      source.emit({ data, origin: PEER_ORIGIN, source: sink });
    }
    expect(probe.onGuestReady).not.toHaveBeenCalled();
    expect(sink.postMessage).not.toHaveBeenCalled();
  });

  it('accepts a genuine GUEST_READY from the Guest window', () => {
    const { source, sink, probe } = setup();
    source.emit({ data: GUEST_READY, origin: PEER_ORIGIN, source: sink });
    expect(probe.onGuestReady).toHaveBeenCalledOnce();
  });
});

describe('HostBus adapter — panel presentation (issue #77)', () => {
  const presentations = (sink: BusSink) =>
    (sink.postMessage as ReturnType<typeof vi.fn>).mock.calls
      .map(([data]) => data)
      .filter((d): d is { type: 'PANEL_PRESENTATION'; payload: { mode: string } } =>
        (d as { type?: string }).type === 'PANEL_PRESENTATION',
      );

  it('buffers the presentation until GUEST_READY, then sends it sessionless', () => {
    const { source, sink, adapter } = setup();
    adapter.setPresentation('lane');
    expect(sink.postMessage).not.toHaveBeenCalled();

    source.emit({ data: GUEST_READY, origin: PEER_ORIGIN, source: sink });
    expect(presentations(sink)).toEqual([
      { v: 1, type: 'PANEL_PRESENTATION', sessionId: '', payload: { mode: 'lane' } },
    ]);
  });

  it('sends on each crossing, not on every re-assertion', () => {
    const { source, sink, adapter } = setup();
    source.emit({ data: GUEST_READY, origin: PEER_ORIGIN, source: sink });
    adapter.setPresentation('lane');
    adapter.setPresentation('lane');
    expect(presentations(sink)).toHaveLength(1);

    adapter.setPresentation('sheet');
    expect(presentations(sink)).toHaveLength(2);
    expect(presentations(sink)[1]!.payload.mode).toBe('sheet');
  });

  it('resends the current presentation when the Guest reloads', () => {
    const { source, sink, adapter } = setup();
    adapter.setPresentation('sheet');
    source.emit({ data: GUEST_READY, origin: PEER_ORIGIN, source: sink });
    source.emit({ data: GUEST_READY, origin: PEER_ORIGIN, source: sink });
    expect(presentations(sink)).toHaveLength(2);
  });
});

describe('HostBus adapter — app-side probe hooks (issue #31)', () => {
  const document = { documentId: 'doc-1', documentTitle: 'Mietvertrag', contentType: 'application/pdf' };

  function dispatch(
    source: FakeSource,
    sink: BusSink,
    adapter: { requestExtraction(d: typeof document, b: ArrayBuffer): void },
  ): string {
    adapter.requestExtraction(document, new ArrayBuffer(4));
    const call = (sink.postMessage as ReturnType<typeof vi.fn>).mock.calls.find(
      ([data]) => (data as { type?: string }).type === 'EXTRACT_DOCUMENT',
    )!;
    return (call[0] as { payload: { jobId: string } }).payload.jobId;
  }

  it('reports the job and its Document when STARTED acks the dispatch', () => {
    const { source, sink, probe, adapter } = setup();
    source.emit({ data: GUEST_READY, origin: PEER_ORIGIN, source: sink });
    const jobId = dispatch(source, sink, adapter);

    source.emit({
      data: { v: 1, type: 'AI_PROCESSING_STARTED', sessionId: '', payload: { jobId } },
      origin: PEER_ORIGIN,
      source: sink,
    });

    expect(probe.jobStarted).toHaveBeenCalledWith(jobId, document);
  });

  it('reports the failing job\'s Document alongside the error', () => {
    const { source, sink, probe, adapter } = setup();
    source.emit({ data: GUEST_READY, origin: PEER_ORIGIN, source: sink });
    const jobId = dispatch(source, sink, adapter);
    source.emit({
      data: { v: 1, type: 'AI_PROCESSING_STARTED', sessionId: '', payload: { jobId } },
      origin: PEER_ORIGIN,
      source: sink,
    });

    const error = { code: 'INVALID_EXTRACTION', message: 'Unreadable.', retryable: true };
    source.emit({
      data: { v: 1, type: 'AI_PROCESSING_ERROR', sessionId: '', payload: { jobId, error } },
      origin: PEER_ORIGIN,
      source: sink,
    });

    expect(probe.jobFailed).toHaveBeenCalledWith(jobId, error);
    expect(probe.jobFailedFor).toHaveBeenCalledWith(jobId, document, error);
  });

  it('fails INVALID_EXTRACTION when SUCCESS carries a foreign documentId', () => {
    const { source, sink, probe, adapter } = setup();
    source.emit({ data: GUEST_READY, origin: PEER_ORIGIN, source: sink });
    const jobId = dispatch(source, sink, adapter);
    source.emit({
      data: { v: 1, type: 'AI_PROCESSING_STARTED', sessionId: '', payload: { jobId } },
      origin: PEER_ORIGIN,
      source: sink,
    });
    const extraction = {
      ...goldenFixtureMessages.AI_PROCESSING_SUCCESS.payload.extraction,
      documentId: 'doc-other',
    };

    source.emit({
      data: { v: 1, type: 'AI_PROCESSING_SUCCESS', sessionId: '', payload: { jobId, extraction } },
      origin: PEER_ORIGIN,
      source: sink,
    });

    expect(probe.jobSucceeded).not.toHaveBeenCalled();
    expect(probe.jobFailed).toHaveBeenCalledWith(
      jobId,
      expect.objectContaining({ code: 'INVALID_EXTRACTION', retryable: true }),
    );
  });

  it('fails INVALID_EXTRACTION when SUCCESS carries a malformed Extraction', () => {
    const { source, sink, probe, adapter } = setup();
    source.emit({ data: GUEST_READY, origin: PEER_ORIGIN, source: sink });
    const jobId = dispatch(source, sink, adapter);
    source.emit({
      data: { v: 1, type: 'AI_PROCESSING_STARTED', sessionId: '', payload: { jobId } },
      origin: PEER_ORIGIN,
      source: sink,
    });

    source.emit({
      data: {
        v: 1,
        type: 'AI_PROCESSING_SUCCESS',
        sessionId: '',
        payload: { jobId, extraction: { documentId: 'doc-1' } },
      },
      origin: PEER_ORIGIN,
      source: sink,
    });

    expect(probe.jobSucceeded).not.toHaveBeenCalled();
    expect(probe.jobFailed).toHaveBeenCalledWith(
      jobId,
      expect.objectContaining({ code: 'INVALID_EXTRACTION' }),
    );
  });

  it('resends the Session under a fresh sessionId on GUEST_READY', () => {
    const { source, sink, adapter } = setup();
    source.emit({ data: GUEST_READY, origin: PEER_ORIGIN, source: sink });
    adapter.openSession({ ...goldenFixtureMessages.INIT_SESSION.payload, sessionId: 'sess-first' });

    source.emit({ data: GUEST_READY, origin: PEER_ORIGIN, source: sink });

    const sessions = (sink.postMessage as ReturnType<typeof vi.fn>).mock.calls
      .map(([data]) => data as { type: string; sessionId: string })
      .filter((d) => d.type === 'INIT_SESSION');
    expect(sessions).toHaveLength(2);
    expect(sessions[0]!.sessionId).toBe('sess-first');
    expect(sessions[1]!.sessionId).not.toBe('sess-first');
  });

  it('lets the app own the re-enqueue when retryRequested accepts', () => {
    const { source, sink, probe, adapter } = setup();
    source.emit({ data: GUEST_READY, origin: PEER_ORIGIN, source: sink });
    dispatch(source, sink, adapter);
    vi.mocked(probe.retryRequested).mockReturnValue(true);

    source.emit({
      data: { v: 1, type: 'RETRY_EXTRACTION', sessionId: '', payload: { documentId: 'doc-1' } },
      origin: PEER_ORIGIN,
      source: sink,
    });

    expect(probe.retryRequested).toHaveBeenCalledWith('doc-1');
    const dispatches = (sink.postMessage as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([data]) => (data as { type?: string }).type === 'EXTRACT_DOCUMENT',
    );
    expect(dispatches).toHaveLength(1);
  });

  it('re-queues from its own job table when the app declines retry ownership', () => {
    const { source, sink, probe, adapter } = setup();
    source.emit({ data: GUEST_READY, origin: PEER_ORIGIN, source: sink });
    const firstJobId = dispatch(source, sink, adapter);
    vi.mocked(probe.retryRequested).mockReturnValue(false);

    source.emit({
      data: { v: 1, type: 'AI_PROCESSING_STARTED', sessionId: '', payload: { jobId: firstJobId } },
      origin: PEER_ORIGIN,
      source: sink,
    });
    source.emit({
      data: {
        v: 1,
        type: 'AI_PROCESSING_ERROR',
        sessionId: '',
        payload: { jobId: firstJobId, error: { code: 'UNKNOWN', message: 'x', retryable: true } },
      },
      origin: PEER_ORIGIN,
      source: sink,
    });
    source.emit({
      data: { v: 1, type: 'RETRY_EXTRACTION', sessionId: '', payload: { documentId: 'doc-1' } },
      origin: PEER_ORIGIN,
      source: sink,
    });

    const dispatches = (sink.postMessage as ReturnType<typeof vi.fn>).mock.calls
      .map(([data]) => data as { type: string; payload: { jobId: string } })
      .filter((d) => d.type === 'EXTRACT_DOCUMENT');
    expect(dispatches).toHaveLength(2);
    expect(dispatches[1]!.payload.jobId).not.toBe(firstJobId);
  });
});

// Issue #78: GUEST_SHOW_PAGE is Session-bound — the Host reports it to the
// app only for the current Session and only with a usable page; a malformed
// `quote`/`critical` is stripped rather than killing the request.
describe('HostBus adapter — GUEST_SHOW_PAGE (issue #78)', () => {
  const session = { ...goldenFixtureMessages.INIT_SESSION.payload, sessionId: 'sess-open' };

  const showPage = (sessionId: string, payload: unknown) => ({
    v: 1,
    type: 'GUEST_SHOW_PAGE',
    sessionId,
    payload,
  });

  it('reports a valid request for the current Session', () => {
    const { source, sink, probe, adapter } = setup();
    adapter.openSession(session);

    source.emit({
      data: showPage('sess-open', { page: 3, quote: 'Frist drei Monate', critical: true }),
      origin: PEER_ORIGIN,
      source: sink,
    });

    expect(probe.pageRequested).toHaveBeenCalledWith({
      page: 3,
      quote: 'Frist drei Monate',
      critical: true,
    });
  });

  it.each([
    ['a stale sessionId', 'sess-stale'],
    ['an empty sessionId', ''],
  ])('ignores the message for %s', (_label, sessionId) => {
    const { source, sink, probe, adapter } = setup();
    adapter.openSession(session);

    source.emit({
      data: showPage(sessionId, { page: 2 }),
      origin: PEER_ORIGIN,
      source: sink,
    });

    expect(probe.pageRequested).not.toHaveBeenCalled();
  });

  it('ignores the message while no Session is open', () => {
    const { source, sink, probe } = setup();
    source.emit({
      data: showPage('sess-open', { page: 2 }),
      origin: PEER_ORIGIN,
      source: sink,
    });
    expect(probe.pageRequested).not.toHaveBeenCalled();
  });

  it.each([
    ['a fractional page', { page: 2.5 }],
    ['a string page', { page: '2' }],
    ['page zero', { page: 0 }],
    ['a negative page', { page: -2 }],
    ['a missing page', { quote: 'q' }],
    ['a non-object payload', 'page 2'],
    ['a null payload', null],
  ])('ignores %s', (_label, payload) => {
    const { source, sink, probe, adapter } = setup();
    adapter.openSession(session);

    source.emit({
      data: showPage('sess-open', payload),
      origin: PEER_ORIGIN,
      source: sink,
    });

    expect(probe.pageRequested).not.toHaveBeenCalled();
  });

  it('strips a non-string quote and non-boolean critical but honours the page', () => {
    const { source, sink, probe, adapter } = setup();
    adapter.openSession(session);

    source.emit({
      data: showPage('sess-open', { page: 3, quote: 42, critical: 'yes' }),
      origin: PEER_ORIGIN,
      source: sink,
    });

    expect(probe.pageRequested).toHaveBeenCalledWith({
      page: 3,
      quote: undefined,
      critical: undefined,
    });
  });

  it('ignores the message from an origin other than the Peer Origin', () => {
    const { source, sink, probe, adapter } = setup();
    adapter.openSession(session);
    source.emit({
      data: showPage('sess-open', { page: 2 }),
      origin: 'http://evil.test',
      source: sink,
    });
    expect(probe.pageRequested).not.toHaveBeenCalled();
  });
});

// Issue #79: GUEST_EXPAND_PANEL is Session-bound — the Host reports it to
// the app only for the current Session. Which detents honour the raise is
// the frame's business, not the adapter's.
describe('HostBus adapter — GUEST_EXPAND_PANEL (issue #79)', () => {
  const session = { ...goldenFixtureMessages.INIT_SESSION.payload, sessionId: 'sess-open' };

  const expandPanel = (sessionId: string) => ({
    v: 1,
    type: 'GUEST_EXPAND_PANEL',
    sessionId,
    payload: {},
  });

  it('reports the request for the current Session', () => {
    const { source, sink, probe, adapter } = setup();
    adapter.openSession(session);

    source.emit({
      data: expandPanel('sess-open'),
      origin: PEER_ORIGIN,
      source: sink,
    });

    expect(probe.panelExpandRequested).toHaveBeenCalledOnce();
  });

  it.each([
    ['a stale sessionId', 'sess-stale'],
    ['an empty sessionId', ''],
  ])('ignores the message for %s', (_label, sessionId) => {
    const { source, sink, probe, adapter } = setup();
    adapter.openSession(session);

    source.emit({
      data: expandPanel(sessionId),
      origin: PEER_ORIGIN,
      source: sink,
    });

    expect(probe.panelExpandRequested).not.toHaveBeenCalled();
  });

  it('ignores the message while no Session is open', () => {
    const { source, sink, probe } = setup();
    source.emit({
      data: expandPanel('sess-open'),
      origin: PEER_ORIGIN,
      source: sink,
    });
    expect(probe.panelExpandRequested).not.toHaveBeenCalled();
  });
});

// Issue #122: GUEST_CREATE_REMINDER is Session-bound like the other panel
// write-backs — the adapter binds the Session's Document and drops a
// malformed `actionItemId`.
describe('HostBus adapter — GUEST_CREATE_REMINDER (issue #122)', () => {
  const session = {
    ...goldenFixtureMessages.INIT_SESSION.payload,
    sessionId: 'sess-open',
    documentId: 'doc-1',
  };

  const createReminder = (sessionId: string, payload: unknown) => ({
    v: 1,
    type: 'GUEST_CREATE_REMINDER',
    sessionId,
    payload,
  });

  it('reports a valid request with the Session’s documentId bound in', () => {
    const { source, sink, probe, adapter } = setup();
    adapter.openSession(session);

    source.emit({
      data: createReminder('sess-open', { actionItemId: 'ai_3f9c2e7b1d4a58', extra: true }),
      origin: PEER_ORIGIN,
      source: sink,
    });

    expect(probe.reminderRequested).toHaveBeenCalledWith({
      documentId: 'doc-1',
      actionItemId: 'ai_3f9c2e7b1d4a58',
    });
  });

  it.each([
    ['a stale sessionId', 'sess-stale'],
    ['an empty sessionId', ''],
  ])('ignores the message for %s', (_label, sessionId) => {
    const { source, sink, probe, adapter } = setup();
    adapter.openSession(session);

    source.emit({
      data: createReminder(sessionId, { actionItemId: 'ai_9f' }),
      origin: PEER_ORIGIN,
      source: sink,
    });

    expect(probe.reminderRequested).not.toHaveBeenCalled();
  });

  it.each([
    ['a missing id', {}],
    ['an empty id', { actionItemId: '' }],
    ['a non-string id', { actionItemId: 7 }],
    ['a non-object payload', 'ai_9f'],
    ['a null payload', null],
  ])('ignores %s', (_label, payload) => {
    const { source, sink, probe, adapter } = setup();
    adapter.openSession(session);

    source.emit({
      data: createReminder('sess-open', payload),
      origin: PEER_ORIGIN,
      source: sink,
    });

    expect(probe.reminderRequested).not.toHaveBeenCalled();
  });
});

// Issue #144: GUEST_SET_ACTION_ITEM_DONE is Session-bound like the other
// panel write-backs — the adapter binds the Session's Document and drops a
// malformed request; pushActionItemStates answers under the same Session.
describe('HostBus adapter — Done marks (issue #144)', () => {
  const session = {
    ...goldenFixtureMessages.INIT_SESSION.payload,
    sessionId: 'sess-open',
    documentId: 'doc-1',
  };

  const setDone = (sessionId: string, payload: unknown) => ({
    v: 1,
    type: 'GUEST_SET_ACTION_ITEM_DONE',
    sessionId,
    payload,
  });

  const statesSent = (sink: BusSink) =>
    (sink.postMessage as ReturnType<typeof vi.fn>).mock.calls
      .map(([data]) => data)
      .filter((d): d is { type: 'ACTION_ITEM_STATES'; sessionId: string; payload: unknown } =>
        (d as { type?: string }).type === 'ACTION_ITEM_STATES',
      );

  it('reports a valid request with the Session’s documentId bound in', () => {
    const { source, sink, probe, adapter } = setup();
    adapter.openSession(session);

    source.emit({
      data: setDone('sess-open', { actionItemId: 'ai_3f9c2e7b1d4a58', done: true, extra: 1 }),
      origin: PEER_ORIGIN,
      source: sink,
    });

    expect(probe.actionItemDoneRequested).toHaveBeenCalledWith({
      documentId: 'doc-1',
      actionItemId: 'ai_3f9c2e7b1d4a58',
      done: true,
    });
  });

  it.each([
    ['a stale sessionId', 'sess-stale'],
    ['an empty sessionId', ''],
  ])('ignores the message for %s', (_label, sessionId) => {
    const { source, sink, probe, adapter } = setup();
    adapter.openSession(session);

    source.emit({
      data: setDone(sessionId, { actionItemId: 'ai_9f', done: true }),
      origin: PEER_ORIGIN,
      source: sink,
    });

    expect(probe.actionItemDoneRequested).not.toHaveBeenCalled();
  });

  it.each([
    ['a missing id', { done: true }],
    ['an empty id', { actionItemId: '', done: true }],
    ['a missing done', { actionItemId: 'ai_9f' }],
    ['a non-boolean done', { actionItemId: 'ai_9f', done: 'yes' }],
    ['a non-object payload', 'ai_9f'],
    ['a null payload', null],
  ])('ignores %s', (_label, payload) => {
    const { source, sink, probe, adapter } = setup();
    adapter.openSession(session);

    source.emit({
      data: setDone('sess-open', payload),
      origin: PEER_ORIGIN,
      source: sink,
    });

    expect(probe.actionItemDoneRequested).not.toHaveBeenCalled();
  });

  it('pushActionItemStates sends the map under the current Session', () => {
    const { sink, adapter } = setup();
    adapter.openSession(session);

    const states = { ai_9f: { doneAt: '2026-10-21T08:00:00.000Z' } };
    adapter.pushActionItemStates(states);

    expect(statesSent(sink)).toEqual([
      { v: 1, type: 'ACTION_ITEM_STATES', sessionId: 'sess-open', payload: { states } },
    ]);
  });

  it('pushActionItemStates is silent without a Session', () => {
    const { sink, adapter } = setup();
    adapter.pushActionItemStates({ ai_9f: { doneAt: 'x' } });
    expect(statesSent(sink)).toEqual([]);
  });
});
