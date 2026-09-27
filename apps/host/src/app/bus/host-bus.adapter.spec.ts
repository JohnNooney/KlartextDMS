import { describe, expect, it, vi } from 'vitest';
import type {
  BusMessageEvent,
  BusMessageListener,
  BusSink,
  BusSource,
} from '@klartext/bus-contract';
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
