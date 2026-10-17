import { Injectable, signal } from '@angular/core';
import type { GuestShowPagePayload } from '@klartext/bus-contract';

/**
 * The reader-side navigator a page request drives — the open Document's PDF
 * viewer. Registered while a Document is open, unregistered on destroy.
 */
export interface PageNavigator {
  /** One-based page count of the open Document — the range check's ceiling. */
  pageCount(): number;
  /** The whole request drives the viewer — `quote`/`critical` ride along (#80). */
  showPage(request: GuestShowPagePayload): void;
}

/** A request that landed — `seq` distinguishes repeats of the same page. */
export interface PageFocusRequest extends GuestShowPagePayload {
  seq: number;
}

/**
 * Where the Guest's "show page" requests land (issue #78). The Bus adapter
 * reports a session-bound, wire-valid request; this service owns the
 * `1..pageCount` range check only the open Document can answer, drives the
 * registered navigator, and publishes `landed` — the mobile sheet rests at
 * half on each landing, and the carried `quote`/`critical` are here for the
 * passage highlight (issue #80).
 */
@Injectable({ providedIn: 'root' })
export class PageFocus {
  private navigator: PageNavigator | null = null;
  private seq = 0;

  /** The last request that actually jumped — `null` until the first lands. */
  readonly landed = signal<PageFocusRequest | null>(null);

  /** Registers the open Document's navigator; the return value unregisters. */
  registerNavigator(navigator: PageNavigator): () => void {
    this.navigator = navigator;
    return () => {
      if (this.navigator === navigator) this.navigator = null;
    };
  }

  /**
   * A wire-valid request lands only for an integer page in `1..pageCount` of
   * the open Document — everything else is ignored, fire-and-forget.
   */
  show(request: GuestShowPagePayload): void {
    const navigator = this.navigator;
    const page = request.page;
    if (!navigator || !Number.isInteger(page) || page < 1 || page > navigator.pageCount()) {
      return;
    }
    navigator.showPage(request);
    this.landed.set({ ...request, seq: ++this.seq });
  }
}
