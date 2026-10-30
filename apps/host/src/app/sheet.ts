import { computed, Directive, ElementRef, inject, input, model, output } from '@angular/core';

/** Travel (px) before a press on the handle counts as a drag, not a tap. */
const DRAG_THRESHOLD_PX = 4;
/** Release speed (px/ms) that moves one detent regardless of height (#62). */
const FLICK_VELOCITY_PX_MS = 0.35;
/** A held-then-released finger isn't a flick — velocity older than this is stale. */
const FLICK_STALE_MS = 150;

/** What a detent's height resolver knows while measuring (issue #152). */
export interface SheetMeasure {
  /** The sheet element. */
  el: HTMLElement;
  /** `window.innerHeight` at measure time. */
  viewportHeight: number;
  /** The sheet's rendered height when the press landed — the exact resting px. */
  pressHeight: number;
  /** The detent the press landed on. */
  pressDetent: string;
}

/** One snap height in a detent sheet (issue #152, ADR 0014). */
export interface SheetDetent {
  name: string;
  /** The detent's target height in px. */
  height: (measure: SheetMeasure) => number;
}

/** One in-flight handle drag. */
interface SheetDrag {
  startY: number;
  /** The sheet's rendered height when the press landed — the exact resting px. */
  startHeight: number;
  startDetent: string;
  moved: boolean;
  lastY: number;
  lastT: number;
  /** px/ms; negative is upward (growing the sheet). */
  velocity: number;
}

/**
 * The one Host primitive every detent sheet shares (issue #152, ADR 0014):
 * a bottom sheet that snaps between an ordered, consumer-configured set of
 * detents — the Guest frame supplies peek / half / full; the attention
 * sheet supplies medium / large (issue #153). Applied to the sheet
 * element, it owns
 * everything a detent sheet owes the user:
 *
 * - **The `data-sheet` attribute** the surface's stylesheet resolves each
 *   detent's height from, written for the current {@link detent}.
 * - **Gestures** driven by a `SheetHandle` inside it: tap-to-cycle through
 *   the detent order, pointer-captured drag that tracks the finger (the
 *   handle stylesheet sets `touch-action: none`), a 4px tap/drag
 *   threshold, smoothed velocity with a 0.35 px/ms flick that moves one
 *   detent, stale-velocity decay, click suppression after a real drag, and
 *   a synchronous `data-sheet` write-back so the settle animates from the
 *   finger.
 * - **An optional dismiss rung** below the smallest detent: with
 *   {@link dismissible} on, releasing below the smallest detent's height —
 *   or flicking down from it — emits {@link dismissRequested}. It is a
 *   request, not an action: the consumer decides whether the sheet closes.
 *
 * The consumer keeps the policy: which detents exist, which one the sheet
 * rests on, what a tap is called, and whether a dismiss request closes.
 * The shared chrome — the settle transition and the grab-handle strip —
 * lives in `sheet.scss`, included alongside the surface's own styles.
 */
@Directive({
  selector: '[appSheet]',
  host: { '[attr.data-sheet]': 'detent()' },
})
export class Sheet {
  /** The detent set, smallest first. */
  readonly detents = input.required<readonly SheetDetent[]>();
  /** The current detent's name — two-way so the consumer can rest the sheet. */
  readonly detent = model.required<string>();
  /** Whether releasing below the smallest detent asks to close the sheet. */
  readonly dismissible = input(false);
  /** A drag or flick asked to drop the sheet below its smallest detent. */
  readonly dismissRequested = output<void>();

  /** The detent a tap moves to — past the largest it wraps to the smallest. */
  readonly next = computed<SheetDetent>(() => {
    const detents = this.detents();
    const index = detents.findIndex((d) => d.name === this.detent());
    return detents[(index + 1) % detents.length]!;
  });
  /** Whether the sheet sits above its smallest detent — the handle's aria-expanded. */
  readonly expanded = computed(() => this.detent() !== this.detents()[0]?.name);

  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private drag: SheetDrag | null = null;
  /** A release after a real drag still fires `click` — it must not cycle. */
  private suppressClick = false;

  /** A handle tap: one step along the detent order, wrapping past the top. */
  cycle(): void {
    if (this.suppressClick) {
      this.suppressClick = false;
      return;
    }
    this.detent.set(this.next().name);
  }

  // ---------- Handle drag (issue #62) ----------
  //
  // While pressed, the sheet's top tracks the finger via an inline height
  // with the transition disabled; release snaps to the nearest detent and
  // re-enables the transition for the settle.

  onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    this.drag = {
      startY: event.clientY,
      startHeight: this.el.getBoundingClientRect().height,
      startDetent: this.detent(),
      moved: false,
      lastY: event.clientY,
      lastT: event.timeStamp,
      velocity: 0,
    };
    this.suppressClick = false;
    // jsdom lacks setPointerCapture — optional; capture keeps the move
    // events on the handle even when the finger slides off it.
    if (event.pointerId != null) {
      (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
    }
  }

  onPointerMove(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag) return;
    if (!drag.moved) {
      if (Math.abs(event.clientY - drag.startY) <= DRAG_THRESHOLD_PX) return;
      drag.moved = true;
      this.el.classList.add('is-dragging');
    }
    const dt = event.timeStamp - drag.lastT;
    // Sub-frame samples carry no timing signal; smooth the rest so one jittery
    // move can't masquerade as a flick.
    if (dt >= 2) {
      drag.velocity = drag.velocity * 0.6 + ((event.clientY - drag.lastY) / dt) * 0.4;
    }
    drag.lastY = event.clientY;
    drag.lastT = event.timeStamp;
    // The handle is the sheet's top edge, so viewport-minus-pointer is the
    // tracked height.
    const height = Math.min(Math.max(window.innerHeight - event.clientY, 0), window.innerHeight);
    this.el.style.height = `${height}px`;
  }

  onPointerUp(event: PointerEvent): void {
    const drag = this.drag;
    this.drag = null;
    if (!drag?.moved) return; // a plain press — let the click cycle
    if (event.type === 'pointerup') this.suppressClick = true;

    const el = this.el;
    // A held-then-released finger isn't a flick — stale velocity must decay.
    const velocity = event.timeStamp - drag.lastT > FLICK_STALE_MS ? 0 : drag.velocity;
    const height = window.innerHeight - event.clientY;
    const measure: SheetMeasure = {
      el,
      viewportHeight: window.innerHeight,
      pressHeight: drag.startHeight,
      pressDetent: drag.startDetent,
    };
    const detents = this.detents();
    const heights = detents.map((d) => d.height(measure));
    let index = heights.reduce(
      (nearest, h, i) => (Math.abs(h - height) < Math.abs(heights[nearest]! - height) ? i : nearest),
      0,
    );
    if (Math.abs(velocity) > FLICK_VELOCITY_PX_MS) index += velocity < 0 ? 1 : -1;

    // Below the smallest detent a dismissible sheet asks to close — a
    // request, not an action: the detent stands until the consumer decides.
    if (this.dismissible() && (index < 0 || (index === 0 && height < heights[0]!))) {
      el.style.height = '';
      el.classList.remove('is-dragging');
      this.dismissRequested.emit();
      return;
    }
    index = Math.min(Math.max(index, 0), detents.length - 1);
    this.detent.set(detents[index]!.name);
    // Write the detent synchronously — the signal's binding lands on the same
    // value next change detection — so dropping the inline height animates
    // from the finger position to the detent, never back to the old one.
    el.dataset['sheet'] = detents[index]!.name;
    el.style.height = '';
    el.classList.remove('is-dragging');
  }
}
