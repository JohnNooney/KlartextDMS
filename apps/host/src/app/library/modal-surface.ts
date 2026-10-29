import { afterNextRender, DestroyRef, Directive, ElementRef, inject, output } from '@angular/core';

/** What a modal surface can hand focus to, DOM order. */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/** The open modal surfaces, in open order — the last one is the topmost. */
const openSurfaces: ModalSurface[] = [];

/** Whether a modal surface is open — global shortcuts must not fire behind a scrim. */
export function modalSurfaceOpen(): boolean {
  return openSurfaces.length > 0;
}

/**
 * Recent focus owners, newest last, capped — when a surface's remembered
 * owner is gone (the ⋮ menu item that launched it is destroyed with the
 * menu), restore walks back to the last owner still in the page.
 */
const focusHistory: HTMLElement[] = [];
const FOCUS_HISTORY_LIMIT = 16;
let trackingFocus = false;

function trackFocus(): void {
  if (trackingFocus) return;
  trackingFocus = true;
  document.addEventListener('focusin', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (focusHistory[focusHistory.length - 1] !== target) {
      focusHistory.push(target);
      if (focusHistory.length > FOCUS_HISTORY_LIMIT) focusHistory.shift();
    }
  });
}

/**
 * The one Host primitive every modal surface — `.dialog` card, alertdialog,
 * Reminder take-over, attention `.sheet` — shares (issue #150, ADR 0014).
 * Applied to the surface element it owns everything a modal owes the page:
 *
 * - **Backdrop.** A labelled scrim button is inserted before the surface;
 *   its click requests close.
 * - **Escape.** Requests close on the *topmost* surface only, so stacked
 *   modals peel one at a time.
 * - **Focus trap.** On open, focus moves into the surface (a control marked
 *   `autofocus`, else the first focusable, else the surface itself); Tab and
 *   Shift+Tab cycle inside it and can never reach the page behind.
 * - **Focus restore.** On destroy, focus returns to the element that held it
 *   before the surface opened.
 * - **Visual-viewport tracking.** Re-centres a centred surface and caps its
 *   height inside the *visual* viewport (issue #64): on iOS the on-screen
 *   keyboard shrinks it while `position: fixed` resolves against the layout
 *   viewport. Edge-anchored surfaces keep their own placement and may fill
 *   the band (issue #122); a surface's own tighter stylesheet cap always
 *   wins. The margin lives in `--kt-modal-margin`.
 *
 * Everything that dismisses — Escape, the backdrop, and explicit close
 * affordances calling {@link requestClose} — funnels into one
 * {@link closeRequested} event. The consumer decides whether the surface
 * actually closes; that's the intercept point a "Discard changes?" flow
 * builds on (#141).
 */
@Directive({
  selector: '[appModalSurface]',
  exportAs: 'appModalSurface',
  host: { '(document:keydown)': 'onKeydown($event)' },
})
export class ModalSurface {
  /** The surface asked to close — it stays open until the consumer tears it down. */
  readonly closeRequested = output<void>();

  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private backdrop: HTMLButtonElement | null = null;
  private restoreFocusTo: Element | null = null;

  constructor() {
    trackFocus();
    const viewport = window.visualViewport;
    if (viewport) {
      viewport.addEventListener('resize', this.place);
      viewport.addEventListener('scroll', this.place);
    }
    afterNextRender(() => {
      this.insertBackdrop();
      openSurfaces.push(this);
      this.captureFocus();
      this.place();
    });
    inject(DestroyRef).onDestroy(() => {
      if (viewport) {
        viewport.removeEventListener('resize', this.place);
        viewport.removeEventListener('scroll', this.place);
      }
      this.backdrop?.remove();
      const index = openSurfaces.indexOf(this);
      if (index !== -1) openSurfaces.splice(index, 1);
      this.restoreFocus();
    });
  }

  /** Every dismiss affordance routes here — Escape, the backdrop, close buttons. */
  requestClose(): void {
    this.closeRequested.emit();
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (openSurfaces[openSurfaces.length - 1] !== this) return;
    if (event.key === 'Escape') this.requestClose();
    else if (event.key === 'Tab') this.trapFocus(event);
  }

  private insertBackdrop(): void {
    const backdrop = document.createElement('button');
    backdrop.type = 'button';
    backdrop.className = 'backdrop';
    backdrop.setAttribute('aria-label', 'Close');
    // A scrim is a click target, not a control — the trap keeps focus inside.
    backdrop.tabIndex = -1;
    backdrop.addEventListener('click', this.onBackdropClick);
    this.el.before(backdrop);
    this.backdrop = backdrop;
  }

  private readonly onBackdropClick = (): void => this.requestClose();

  private captureFocus(): void {
    this.restoreFocusTo = document.activeElement;
    const target =
      this.el.querySelector<HTMLElement>('[autofocus]') ?? this.focusables()[0] ?? this.el;
    if (target === this.el && !this.el.hasAttribute('tabindex')) this.el.tabIndex = -1;
    target.focus();
  }

  private restoreFocus(): void {
    const candidates = [this.restoreFocusTo, ...focusHistory.slice().reverse()];
    for (const candidate of candidates) {
      // body/documentElement mean "nothing held focus" — keep walking.
      if (
        !(candidate instanceof HTMLElement) ||
        candidate === document.body ||
        candidate === document.documentElement ||
        !candidate.isConnected
      ) {
        continue;
      }
      candidate.focus();
      return;
    }
  }

  private trapFocus(event: KeyboardEvent): void {
    const focusables = this.focusables();
    if (focusables.length === 0) {
      event.preventDefault();
      this.el.focus();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    const inside = active !== null && this.el.contains(active);
    const leaving = event.shiftKey ? !inside || active === first : !inside || active === last;
    if (!leaving) return;
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  }

  private focusables(): HTMLElement[] {
    return [...this.el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => {
      if (el.hasAttribute('hidden')) return false;
      const style = getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden';
    });
  }

  /**
   * Keeps the surface inside the visible band. Edge-anchored variants keep
   * their own placement and may fill it; centred ones re-centre with the
   * `--kt-modal-margin` clearance. The surface's own stylesheet cap always
   * wins over the tracking cap — tracking only tightens.
   */
  private readonly place = (): void => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const el = this.el;
    const bottom = getComputedStyle(el).bottom;
    const anchored = bottom !== 'auto' && bottom !== '';
    el.style.top = anchored ? '' : `${viewport.offsetTop + viewport.height / 2}px`;
    // The surface's own stylesheet cap always wins — tracking only tightens.
    // Clearing the inline value first lets the computed one report the
    // stylesheet's, which may itself change across breakpoints.
    el.style.maxHeight = '';
    const natural = parseFloat(getComputedStyle(el).maxHeight) || Number.POSITIVE_INFINITY;
    const margin = anchored ? 0 : modalMargin(el);
    el.style.maxHeight = `${Math.min(natural, Math.max(viewport.height - margin, 0))}px`;
  };
}

function modalMargin(el: HTMLElement): number {
  return parseFloat(getComputedStyle(el).getPropertyValue('--kt-modal-margin')) || 0;
}
