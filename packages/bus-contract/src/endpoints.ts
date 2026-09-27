/**
 * Bus endpoints — the injection seam every adapter is written against
 * (issue #25). In production `source` wraps `window`/`window.parent` message
 * events and `sink` is the peer frame's `WindowProxy`; in tests both come
 * from `createLinkedBusPair()` in `@klartext/bus-contract/testing`.
 */

export interface BusMessageEvent {
  readonly data: unknown;
  readonly origin: string;
  /** The peer's window as the receiver knows it — equal to the BusSink this side posts to. */
  readonly source: BusSink;
}

export type BusMessageListener = (event: BusMessageEvent) => void;

/** The side an adapter listens on — the `window` it would `addEventListener`. */
export interface BusSource {
  addEventListener(type: 'message', listener: BusMessageListener): void;
  removeEventListener(type: 'message', listener: BusMessageListener): void;
}

/** The side an adapter posts to — `iframe.contentWindow` / `window.parent`. */
export interface BusSink {
  postMessage(data: unknown, targetOrigin: string, transfer?: Transferable[]): void;
}

export interface BusEnd {
  readonly source: BusSource;
  readonly sink: BusSink;
}
