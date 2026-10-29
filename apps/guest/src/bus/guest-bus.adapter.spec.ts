import { describe, expect, it, vi } from 'vitest';
import type {
  BusMessageEvent,
  BusMessageListener,
  BusSink,
  BusSource,
} from '@klartext/bus-contract';
import type { GuestProbe } from '@klartext/bus-contract/conformance';
import { createGuestBusAdapter } from './guest-bus.adapter';

const PEER_ORIGIN = 'http://host.test';

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
  const probe: GuestProbe = {
    sessionApplied: vi.fn(),
    presentationApplied: vi.fn(),
    actionItemStatesApplied: vi.fn(),
  };
  const runJob = vi.fn(() => Promise.reject(new Error('not used')));
  const adapter = createGuestBusAdapter({
    source,
    sink,
    peerOrigin: PEER_ORIGIN,
    probe,
    runJob,
  });
  return { source, sink, probe, runJob, adapter };
}

const INIT_SESSION = {
  v: 1,
  type: 'INIT_SESSION',
  sessionId: 'sess_1',
  payload: { sessionId: 'sess_1' },
};

describe('GuestBus adapter — receive-side checks', () => {
  it('ignores messages from an origin other than the Peer Origin', () => {
    const { source, sink, probe } = setup();
    source.emit({ data: INIT_SESSION, origin: 'http://evil.test', source: sink });
    expect(probe.sessionApplied).not.toHaveBeenCalled();
    expect(sink.postMessage).not.toHaveBeenCalled();
  });

  it('ignores messages whose source is not the Host window', () => {
    const { source, sink, probe } = setup();
    const stranger: BusSink = { postMessage: vi.fn() };
    source.emit({ data: INIT_SESSION, origin: PEER_ORIGIN, source: stranger });
    expect(probe.sessionApplied).not.toHaveBeenCalled();
    expect(sink.postMessage).not.toHaveBeenCalled();
  });

  it('ignores non-Envelope payloads without crashing', () => {
    const { source, sink, probe } = setup();
    for (const data of ['not an envelope', 42, null, { v: 2 }, { type: 'INIT_SESSION' }]) {
      source.emit({ data, origin: PEER_ORIGIN, source: sink });
    }
    expect(probe.sessionApplied).not.toHaveBeenCalled();
    expect(sink.postMessage).not.toHaveBeenCalled();
  });

  it('acks a genuine INIT_SESSION from the Host window', () => {
    const { source, sink, probe } = setup();
    source.emit({ data: INIT_SESSION, origin: PEER_ORIGIN, source: sink });
    expect(sink.postMessage).toHaveBeenCalledWith(
      { v: 1, type: 'SESSION_ACK', sessionId: 'sess_1', payload: {} },
      PEER_ORIGIN,
    );
    expect(probe.sessionApplied).toHaveBeenCalledWith(INIT_SESSION.payload);
  });
});

describe('GuestBus adapter — panel presentation (issue #77)', () => {
  const presentation = (mode: unknown) => ({
    v: 1,
    type: 'PANEL_PRESENTATION',
    sessionId: '',
    payload: { mode },
  });

  it('applies a lane or sheet presentation to the probe', () => {
    const { source, sink, probe } = setup();
    source.emit({ data: presentation('lane'), origin: PEER_ORIGIN, source: sink });
    expect(probe.presentationApplied).toHaveBeenCalledWith('lane');
    source.emit({ data: presentation('sheet'), origin: PEER_ORIGIN, source: sink });
    expect(probe.presentationApplied).toHaveBeenLastCalledWith('sheet');
  });

  it('ignores an invalid mode', () => {
    const { source, sink, probe } = setup();
    for (const mode of ['drawer', 3, null, undefined]) {
      source.emit({ data: presentation(mode), origin: PEER_ORIGIN, source: sink });
    }
    expect(probe.presentationApplied).not.toHaveBeenCalled();
  });

  it('ignores a presentation from an origin other than the Peer Origin', () => {
    const { source, sink, probe } = setup();
    source.emit({ data: presentation('lane'), origin: 'http://evil.test', source: sink });
    expect(probe.presentationApplied).not.toHaveBeenCalled();
  });
});

describe('GuestBus adapter — GUEST_SHOW_PAGE (issue #78)', () => {
  it('sends the page request under the applied Session’s id', () => {
    const { source, sink, adapter } = setup();
    source.emit({ data: INIT_SESSION, origin: PEER_ORIGIN, source: sink });

    adapter.showPage({ page: 3, quote: 'Die Kündigungsfrist beträgt drei Monate.', critical: true });

    expect(sink.postMessage).toHaveBeenCalledWith(
      {
        v: 1,
        type: 'GUEST_SHOW_PAGE',
        sessionId: 'sess_1',
        payload: { page: 3, quote: 'Die Kündigungsfrist beträgt drei Monate.', critical: true },
      },
      PEER_ORIGIN,
    );
  });

  it('sends nothing before a Session exists', () => {
    const { sink, adapter } = setup();
    adapter.showPage({ page: 2 });
    expect(sink.postMessage).not.toHaveBeenCalled();
  });

  it('sends under the latest Session after a re-INIT', () => {
    const { source, sink, adapter } = setup();
    source.emit({ data: INIT_SESSION, origin: PEER_ORIGIN, source: sink });
    source.emit({
      data: { ...INIT_SESSION, sessionId: 'sess_2', payload: { sessionId: 'sess_2' } },
      origin: PEER_ORIGIN,
      source: sink,
    });

    adapter.showPage({ page: 1 });

    expect(sink.postMessage).toHaveBeenLastCalledWith(
      { v: 1, type: 'GUEST_SHOW_PAGE', sessionId: 'sess_2', payload: { page: 1 } },
      PEER_ORIGIN,
    );
  });
});

describe('GuestBus adapter — GUEST_EXPAND_PANEL (issue #79)', () => {
  it('sends the expand request under the applied Session’s id', () => {
    const { source, sink, adapter } = setup();
    source.emit({ data: INIT_SESSION, origin: PEER_ORIGIN, source: sink });

    adapter.expandPanel();

    expect(sink.postMessage).toHaveBeenCalledWith(
      { v: 1, type: 'GUEST_EXPAND_PANEL', sessionId: 'sess_1', payload: {} },
      PEER_ORIGIN,
    );
  });

  it('sends nothing before a Session exists', () => {
    const { sink, adapter } = setup();
    adapter.expandPanel();
    expect(sink.postMessage).not.toHaveBeenCalled();
  });

  it('sends under the latest Session after a re-INIT', () => {
    const { source, sink, adapter } = setup();
    source.emit({ data: INIT_SESSION, origin: PEER_ORIGIN, source: sink });
    source.emit({
      data: { ...INIT_SESSION, sessionId: 'sess_2', payload: { sessionId: 'sess_2' } },
      origin: PEER_ORIGIN,
      source: sink,
    });

    adapter.expandPanel();

    expect(sink.postMessage).toHaveBeenLastCalledWith(
      { v: 1, type: 'GUEST_EXPAND_PANEL', sessionId: 'sess_2', payload: {} },
      PEER_ORIGIN,
    );
  });
});

describe('GuestBus adapter — GUEST_CREATE_REMINDER (issue #122)', () => {
  it('sends the reminder request under the applied Session’s id', () => {
    const { source, sink, adapter } = setup();
    source.emit({ data: INIT_SESSION, origin: PEER_ORIGIN, source: sink });

    adapter.createReminder('ai_3f9c2e7b1d4a58');

    expect(sink.postMessage).toHaveBeenCalledWith(
      {
        v: 1,
        type: 'GUEST_CREATE_REMINDER',
        sessionId: 'sess_1',
        payload: { actionItemId: 'ai_3f9c2e7b1d4a58' },
      },
      PEER_ORIGIN,
    );
  });

  it('sends nothing before a Session exists', () => {
    const { sink, adapter } = setup();
    adapter.createReminder('ai_3f9c2e7b1d4a58');
    expect(sink.postMessage).not.toHaveBeenCalled();
  });
});

describe('GuestBus adapter — Done marks (issue #144)', () => {
  const statesPush = (sessionId: string, payload: unknown) => ({
    v: 1,
    type: 'ACTION_ITEM_STATES',
    sessionId,
    payload,
  });

  it('sends the mark under the applied Session’s id', () => {
    const { source, sink, adapter } = setup();
    source.emit({ data: INIT_SESSION, origin: PEER_ORIGIN, source: sink });

    adapter.setActionItemDone('ai_3f9c2e7b1d4a58', true);

    expect(sink.postMessage).toHaveBeenCalledWith(
      {
        v: 1,
        type: 'GUEST_SET_ACTION_ITEM_DONE',
        sessionId: 'sess_1',
        payload: { actionItemId: 'ai_3f9c2e7b1d4a58', done: true },
      },
      PEER_ORIGIN,
    );
  });

  it('sends nothing before a Session exists', () => {
    const { sink, adapter } = setup();
    adapter.setActionItemDone('ai_3f9c2e7b1d4a58', true);
    expect(sink.postMessage).not.toHaveBeenCalled();
  });

  it('applies a well-formed ACTION_ITEM_STATES push for the current Session', () => {
    const { source, sink, probe, adapter } = setup();
    void adapter;
    source.emit({ data: INIT_SESSION, origin: PEER_ORIGIN, source: sink });

    const states = { ai_1: { doneAt: '2026-10-21T08:00:00.000Z', doneThrough: '2026-11-03' } };
    source.emit({
      data: statesPush('sess_1', { states }),
      origin: PEER_ORIGIN,
      source: sink,
    });

    expect(probe.actionItemStatesApplied).toHaveBeenCalledWith(states);
  });

  it.each([
    ['a stale sessionId', 'sess-stale'],
    ['an empty sessionId', ''],
  ])('ignores the push for %s', (_label, sessionId) => {
    const { source, sink, probe, adapter } = setup();
    void adapter;
    source.emit({ data: INIT_SESSION, origin: PEER_ORIGIN, source: sink });

    source.emit({
      data: statesPush(sessionId, { states: { ai_1: { doneAt: 'x' } } }),
      origin: PEER_ORIGIN,
      source: sink,
    });

    expect(probe.actionItemStatesApplied).not.toHaveBeenCalled();
  });

  it('ignores a malformed push and strips malformed entries', () => {
    const { source, sink, probe, adapter } = setup();
    void adapter;
    source.emit({ data: INIT_SESSION, origin: PEER_ORIGIN, source: sink });

    for (const payload of [{}, { states: 'done' }, { states: [] }, null, 'x']) {
      source.emit({ data: statesPush('sess_1', payload), origin: PEER_ORIGIN, source: sink });
    }
    expect(probe.actionItemStatesApplied).not.toHaveBeenCalled();

    source.emit({
      data: statesPush('sess_1', { states: { good: { doneAt: 'x' }, bad: { doneThrough: 'y' } } }),
      origin: PEER_ORIGIN,
      source: sink,
    });
    expect(probe.actionItemStatesApplied).toHaveBeenCalledWith({ good: { doneAt: 'x' } });
  });
});
