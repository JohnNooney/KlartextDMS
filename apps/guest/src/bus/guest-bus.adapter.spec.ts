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
  const probe: GuestProbe = { sessionApplied: vi.fn() };
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
