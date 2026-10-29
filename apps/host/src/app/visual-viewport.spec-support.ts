/**
 * Shared spec stub for `window.visualViewport` (issues #64, #149, #150):
 * jsdom has none, so specs drive a controllable fake and restore the real
 * one afterwards — see `useVisualViewport` / `restoreVisualViewport`.
 */
export class FakeVisualViewport extends EventTarget {
  constructor(
    public height: number,
    public offsetTop = 0,
  ) {
    super();
  }
}

let original: PropertyDescriptor | undefined;

/** Installs the fake as `window.visualViewport` — `null` simulates its absence. */
export function useVisualViewport(viewport: FakeVisualViewport | null): void {
  original = Object.getOwnPropertyDescriptor(window, 'visualViewport');
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
}

/** Restores whatever `window.visualViewport` was before `useVisualViewport`. */
export function restoreVisualViewport(): void {
  if (original) Object.defineProperty(window, 'visualViewport', original);
  else delete (window as { visualViewport?: unknown }).visualViewport;
  original = undefined;
}
