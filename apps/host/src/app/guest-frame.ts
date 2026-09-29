import {
  afterNextRender,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  linkedSignal,
  NgZone,
  viewChild,
} from '@angular/core';
import { DomSanitizer, type SafeResourceUrl } from '@angular/platform-browser';
import type { HostAdapter } from '@klartext/bus-contract/conformance';
import { HOST_BUS_ADAPTER_FACTORY } from './bus/host-bus.adapter';
import { HostBusEvents } from './bus/host-bus-events';
import { HostBus } from './bus/host-bus';
import { windowBusSource } from './bus/window-bus';
import { HOST_CONFIG } from './host-config';
import { OpenDocument } from './open-document';

/** The sheet's snap heights (issue #50), smallest first. */
type SheetState = 'peek' | 'half' | 'full';
const SHEET_ORDER: readonly SheetState[] = ['peek', 'half', 'full'];
/** Travel (px) before a press on the handle counts as a drag, not a tap. */
const DRAG_THRESHOLD_PX = 4;
/** Release speed (px/ms) that moves one detent regardless of height (#62). */
const FLICK_VELOCITY_PX_MS = 0.35;
/** Peek's chrome height -- equals --kt-sheet-peek-height (44 + 32); used when
 *  the resolved value can't be measured (jsdom). */
const PEEK_HEIGHT_FALLBACK_PX = 76;

/** One in-flight handle drag. */
interface SheetDrag {
  startY: number;
  /** The sheet's rendered height when the press landed — the exact peek px. */
  startHeight: number;
  startState: SheetState;
  moved: boolean;
  lastY: number;
  lastT: number;
  /** px/ms; negative is upward (growing the sheet). */
  velocity: number;
}

/**
 * The Guest's iframe: mounted once after sign-in and kept mounted — hidden —
 * for the whole session so background Extraction Jobs survive navigation
 * (issue #25); it displays only while a Document is open (issue #16). Its
 * `contentWindow` is the Bus sink; `window` is the source. Message listening
 * runs outside the Angular zone so Bus traffic doesn't trigger change
 * detection. The live adapter is exposed to the app as `HostBus` so Sessions
 * and Extraction Jobs flow without components owning Bus wiring.
 */
@Component({
  selector: 'app-guest-frame',
  templateUrl: './guest-frame.html',
  styleUrl: './guest-frame.scss',
})
export class GuestFrame {
  private readonly frame = viewChild.required<ElementRef<HTMLIFrameElement>>('frame');
  private readonly host = viewChild.required<ElementRef<HTMLElement>>('host');
  private adapter: HostAdapter | null = null;
  private drag: SheetDrag | null = null;
  /** A release after a real drag still fires `click` — it must not cycle. */
  private suppressClick = false;

  protected readonly guestUrl: SafeResourceUrl;
  /** Whether a Document is open — the frame displays only then (#28). */
  protected readonly docOpen = inject(OpenDocument).docId;
  /**
   * Mobile bottom-sheet detent (issue #50): rests at peek so the PDF stays
   * primary, cycles peek → half → full → peek on handle taps, and tracks
   * the finger while dragging — snapping to the nearest detent on release
   * (issue #62). Linked to the open Document — opening another Document
   * rests the sheet at peek.
   */
  protected readonly sheetState = linkedSignal<string | null, SheetState>({
    source: this.docOpen,
    computation: () => 'peek',
  });
  /** The detent's index in peek → half → full order, driving the dots. */
  protected readonly sheetIndex = computed(() => SHEET_ORDER.indexOf(this.sheetState()));
  /** The tap's result, for the chevron's direction and the button's label. */
  protected readonly nextSheet = computed<SheetState>(
    () => SHEET_ORDER[(this.sheetIndex() + 1) % SHEET_ORDER.length]!,
  );
  protected readonly sheetLabel = computed(
    () =>
      ({
        half: 'Expand insights panel',
        full: 'Expand insights panel to full screen',
        peek: 'Collapse insights panel',
      })[this.nextSheet()],
  );
  protected cycleSheet(): void {
    if (this.suppressClick) {
      this.suppressClick = false;
      return;
    }
    this.sheetState.set(this.nextSheet());
  }

  // ---------- Handle drag (issue #62) ----------
  //
  // The handle strip is its own row above the iframe, so the drag can never
  // be swallowed by Guest content. While pressed, the sheet's top tracks the
  // finger via an inline height with the transition disabled; release snaps
  // to the nearest detent and re-enables the transition for the settle.

  protected onHandlePointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    const host = this.host().nativeElement;
    this.drag = {
      startY: event.clientY,
      startHeight: host.getBoundingClientRect().height,
      startState: this.sheetState(),
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

  protected onHandlePointerMove(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag) return;
    if (!drag.moved) {
      if (Math.abs(event.clientY - drag.startY) <= DRAG_THRESHOLD_PX) return;
      drag.moved = true;
      this.host().nativeElement.classList.add('is-dragging');
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
    this.host().nativeElement.style.height = `${height}px`;
  }

  protected onHandlePointerUp(event: PointerEvent): void {
    const drag = this.drag;
    this.drag = null;
    if (!drag?.moved) return; // a plain press — let the click cycle
    if (event.type === 'pointerup') this.suppressClick = true;

    // A held-then-released finger isn't a flick — stale velocity must decay.
    const velocity = event.timeStamp - drag.lastT > 150 ? 0 : drag.velocity;
    const nearest = this.nearestDetent(window.innerHeight - event.clientY, drag);
    const target =
      Math.abs(velocity) > FLICK_VELOCITY_PX_MS
        ? SHEET_ORDER[
            Math.min(
              Math.max(SHEET_ORDER.indexOf(nearest) + (velocity < 0 ? 1 : -1), 0),
              SHEET_ORDER.length - 1,
            )
          ]!
        : nearest;
    this.sheetState.set(target);
    // Write the detent synchronously — the signal's binding lands on the same
    // value next change detection — so dropping the inline height animates
    // from the finger position to the detent, never back to the old one.
    const host = this.host().nativeElement;
    host.dataset['sheet'] = target;
    host.style.height = '';
    host.classList.remove('is-dragging');
  }

  private nearestDetent(height: number, drag: SheetDrag): SheetState {
    const vh = window.innerHeight;
    const peek =
      drag.startState === 'peek' && drag.startHeight > 0
        ? drag.startHeight
        : PEEK_HEIGHT_FALLBACK_PX +
          (parseFloat(getComputedStyle(this.host().nativeElement).paddingBottom) || 0);
    const detents: Record<SheetState, number> = { peek, half: vh * 0.5, full: vh };
    return SHEET_ORDER.reduce((a, b) =>
      Math.abs(detents[b] - height) < Math.abs(detents[a] - height) ? b : a,
    );
  }

  constructor() {
    const config = inject(HOST_CONFIG);
    const zone = inject(NgZone);
    const events = inject(HostBusEvents);
    const bus = inject(HostBus);
    const createAdapter = inject(HOST_BUS_ADAPTER_FACTORY);
    this.guestUrl = inject(DomSanitizer).bypassSecurityTrustResourceUrl(config.guestOrigin);

    afterNextRender(() => {
      const contentWindow = this.frame().nativeElement.contentWindow;
      if (!contentWindow) return;
      zone.runOutsideAngular(() => {
        this.adapter = createAdapter({
          source: windowBusSource(window),
          sink: contentWindow,
          peerOrigin: config.guestOrigin,
          probe: events,
        });
        bus.attach(this.adapter);
      });
    });

    inject(DestroyRef).onDestroy(() => {
      if (this.adapter) bus.detach(this.adapter);
      this.adapter?.dispose();
      this.adapter = null;
    });
  }
}
