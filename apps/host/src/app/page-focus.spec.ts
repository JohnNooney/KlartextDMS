import { describe, expect, it, vi } from 'vitest';
import { PageFocus } from './page-focus';

// Issue #78: the Guest's "show page" requests land here — the service owns
// the `1..pageCount` range check only the open Document can answer, drives
// the registered viewer, and publishes `landed` so the mobile sheet can drop
// to peek (and #80 can later highlight the quoted passage).
describe('PageFocus', () => {
  const navigator = (numPages = 4) => ({
    pageCount: vi.fn(() => numPages),
    goToPage: vi.fn(),
  });

  it('jumps the registered navigator and publishes the landed request', () => {
    const focus = new PageFocus();
    const nav = navigator();
    focus.registerNavigator(nav);

    focus.show({ page: 3, quote: 'q', critical: true });

    expect(nav.goToPage).toHaveBeenCalledWith(3);
    expect(focus.landed()).toEqual({ page: 3, quote: 'q', critical: true, seq: 1 });
  });

  it('ignores requests while no navigator is registered', () => {
    const focus = new PageFocus();
    focus.show({ page: 1 });
    expect(focus.landed()).toBeNull();
  });

  it.each([0, -1, 5, 2.5, Number.NaN])(
    'ignores a page outside the open Document’s range — %s',
    (page) => {
      const focus = new PageFocus();
      const nav = navigator(4);
      focus.registerNavigator(nav);

      focus.show({ page });

      expect(nav.goToPage).not.toHaveBeenCalled();
      expect(focus.landed()).toBeNull();
    },
  );

  it('bumps the sequence on every landed request — same page twice still lands', () => {
    const focus = new PageFocus();
    const nav = navigator();
    focus.registerNavigator(nav);

    focus.show({ page: 2 });
    focus.show({ page: 2 });

    expect(nav.goToPage).toHaveBeenCalledTimes(2);
    expect(focus.landed()?.seq).toBe(2);
  });

  it('stops driving the navigator after it unregisters', () => {
    const focus = new PageFocus();
    const nav = navigator();
    const unregister = focus.registerNavigator(nav);

    focus.show({ page: 1 });
    unregister();
    focus.show({ page: 1 });

    expect(nav.goToPage).toHaveBeenCalledTimes(1);
    expect(focus.landed()?.seq).toBe(1);
  });
});
