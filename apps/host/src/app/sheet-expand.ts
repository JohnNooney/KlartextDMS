import { Injectable, signal } from '@angular/core';

/**
 * Where the Guest's expand-panel requests land (issue #79). A jump-bar tap
 * sends `GUEST_EXPAND_PANEL` because the Guest can't raise its own frame —
 * the Guest frame watches `requested` and lifts a peeking sheet to half;
 * every other detent, and the desktop lane, ignores the request.
 */
@Injectable({ providedIn: 'root' })
export class SheetExpand {
  /** Requests landed so far — the count distinguishes repeats. */
  readonly requested = signal(0);

  request(): void {
    this.requested.update((seq) => seq + 1);
  }
}
