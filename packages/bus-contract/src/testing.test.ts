import { describe, expect, it, vi } from 'vitest';
import { createLinkedBusPair, type BusMessageEvent } from './testing.js';

const HOST = 'http://localhost:4200';
const GUEST = 'http://localhost:5173';

function pair() {
  return createLinkedBusPair({ hostOrigin: HOST, guestOrigin: GUEST });
}

describe('createLinkedBusPair', () => {
  it('delivers host → guest synchronously with sender origin stamped', () => {
    const { host, guest } = pair();
    const seen: BusMessageEvent[] = [];
    let sync = false;
    guest.source.addEventListener('message', (e) => {
      seen.push(e);
      sync = true;
    });
    host.sink.postMessage({ hello: 1 }, GUEST);
    expect(sync).toBe(true);
    expect(seen[0]).toMatchObject({ data: { hello: 1 }, origin: HOST });
    // event.source is the peer window as the receiver knows it: what the
    // receiver itself posts to (guest.sink is the Host's window).
    expect(seen[0]!.source).toBe(guest.sink);
  });

  it('delivers guest → host with the same semantics', () => {
    const { host, guest } = pair();
    const seen: BusMessageEvent[] = [];
    host.source.addEventListener('message', (e) => seen.push(e));
    guest.sink.postMessage('pong', HOST);
    expect(seen[0]).toMatchObject({ data: 'pong', origin: GUEST });
    expect(seen[0]!.source).toBe(host.sink);
  });

  it('clones message data (postMessage semantics, no shared references)', () => {
    const { host, guest } = pair();
    const seen: BusMessageEvent[] = [];
    guest.source.addEventListener('message', (e) => seen.push(e));
    const data = { nested: { n: 1 } };
    host.sink.postMessage(data, GUEST);
    data.nested.n = 99;
    expect(seen[0]!.data).toEqual({ nested: { n: 1 } });
    expect(seen[0]!.data).not.toBe(data);
  });

  it('detaches ArrayBuffers listed in the transfer list', () => {
    const { host, guest } = pair();
    const seen: BusMessageEvent[] = [];
    guest.source.addEventListener('message', (e) => seen.push(e));
    const bytes = new TextEncoder().encode('%PDF-1.4\n').buffer as ArrayBuffer;
    host.sink.postMessage({ bytes }, GUEST, [bytes]);
    expect(bytes.byteLength).toBe(0); // detached sender-side, like the real Bus
    const received = (seen[0]!.data as { bytes: ArrayBuffer }).bytes;
    expect(new TextDecoder().decode(received)).toBe('%PDF-1.4\n');
  });

  it('drops messages whose targetOrigin is not the peer origin', () => {
    const { host, guest } = pair();
    const listener = vi.fn();
    guest.source.addEventListener('message', listener);
    host.sink.postMessage('x', 'https://evil.example');
    expect(listener).not.toHaveBeenCalled();
    host.sink.postMessage('x', GUEST);
    host.sink.postMessage('x', '*');
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('supports removeEventListener', () => {
    const { host, guest } = pair();
    const listener = vi.fn();
    guest.source.addEventListener('message', listener);
    guest.source.removeEventListener('message', listener);
    host.sink.postMessage('x', GUEST);
    expect(listener).not.toHaveBeenCalled();
  });
});
