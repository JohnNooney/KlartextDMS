import type { BusMessageListener, BusSource } from '@klartext/bus-contract';

/**
 * Adapts `window` to the contract's `BusSource`. The DOM `MessageEvent`
 * carries the same `data`/`origin`/`source` fields the adapter reads; the
 * `source` it reports is the Guest's `WindowProxy` — the same object the
 * adapter's `sink` posts to, so the source check holds on the real Bus.
 */
export function windowBusSource(win: Window): BusSource {
  return {
    addEventListener: (_type, listener: BusMessageListener) =>
      win.addEventListener('message', listener as (event: MessageEvent) => void),
    removeEventListener: (_type, listener: BusMessageListener) =>
      win.removeEventListener('message', listener as (event: MessageEvent) => void),
  };
}
