import { vi } from 'vitest';

/**
 * Shared spec stub for MenuViewport wiring checks (issue #149): jsdom
 * reports zeroed rects, so this parks every `.menu` element's rect past the
 * viewport bottom — the directive must tag it `.is-up`. Restore the spy when
 * the spec is done.
 */
export function menuOverflowingViewport() {
  const real = HTMLElement.prototype.getBoundingClientRect;
  return vi
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('menu') ? ({ bottom: 2000 } as DOMRect) : real.call(this);
    });
}
