import {
  afterNextRender,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  linkedSignal,
  NgZone,
  untracked,
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
import { PageFocus } from './page-focus';
import { Sheet, type SheetDetent } from './sheet';
import { SheetHandle } from './sheet-handle';
import { SheetExpand } from './sheet-expand';

/** Peek's chrome height -- equals --kt-sheet-peek-height (2 × 44: handle
 *  strip plus the Guest's jump bar); used when the resolved value can't be
 *  measured (jsdom). */
const PEEK_HEIGHT_FALLBACK_PX = 88;
/**
 * The lane/sheet breakpoint (issue #77): the same 768px the frame's media
 * queries switch on. The Guest can't tell lane from sheet by its own
 * viewport — the widths are within ~50px — so the Host reports it.
 */
const MOBILE_MEDIA_QUERY = '(max-width: 768px)';

/**
 * The Guest sheet's detent set (issue #50), smallest first. Peek is just
 * the chrome — grab-handle strip plus the top of the Guest frame (its
 * section jump bar, issue #79); its px come from --kt-sheet-peek-height
 * via the stylesheet, measured live off the press while dragging — the
 * fallback covers layouts that can't be measured (jsdom).
 */
const GUEST_DETENTS: readonly SheetDetent[] = [
  {
    name: 'peek',
    height: ({ el, pressDetent, pressHeight }) =>
      pressDetent === 'peek' && pressHeight > 0
        ? pressHeight
        : PEEK_HEIGHT_FALLBACK_PX +
          (parseFloat(getComputedStyle(el).paddingBottom) || 0),
  },
  { name: 'half', height: ({ viewportHeight }) => viewportHeight * 0.5 },
  { name: 'full', height: ({ viewportHeight }) => viewportHeight },
];

/**
 * The Guest's iframe: mounted once after sign-in and kept mounted — hidden —
 * for the whole session so background Extraction Jobs survive navigation
 * (issue #25); it displays only while a Document is open (issue #16). Its
 * `contentWindow` is the Bus sink; `window` is the source. Message listening
 * runs outside the Angular zone so Bus traffic doesn't trigger change
 * detection. The live adapter is exposed to the app as `HostBus` so Sessions
 * and Extraction Jobs flow without components owning Bus wiring.
 *
 * On phones the frame presents as a bottom sheet (issue #50) driven by the
 * shared Sheet primitive (issue #152, ADR 0014); this component keeps only
 * the Guest's Presentation concerns — the detent set, which detent a Bus
 * request rests on, and the `PANEL_PRESENTATION` report.
 */
@Component({
  selector: 'app-guest-frame',
  templateUrl: './guest-frame.html',
  styleUrls: ['./guest-frame.scss', './sheet.scss'],
  imports: [Sheet, SheetHandle],
})
export class GuestFrame {
  private readonly frame = viewChild.required<ElementRef<HTMLIFrameElement>>('frame');
  private readonly sheet = viewChild.required(Sheet);
  private adapter: HostAdapter | null = null;
  /** Removes the breakpoint listener wired by {@link watchPresentation}. */
  private unwatchPresentation: (() => void) | null = null;

  protected readonly guestUrl: SafeResourceUrl;
  protected readonly detents = GUEST_DETENTS;
  /** Whether a Document is open — the frame displays only then (#28). */
  protected readonly docOpen = inject(OpenDocument).docId;
  /**
   * Whether the toolbar toggle hides the lane (issue #76): desktop-only —
   * the mobile sheet's detents already cover show/hide. Hidden by class so
   * the iframe stays mounted for background Extraction Jobs (ADR 0003).
   */
  protected readonly laneHidden = inject(OpenDocument).insightsLaneHidden;
  /**
   * Mobile bottom-sheet detent (issue #50): rests at peek so the PDF stays
   * primary. Linked to the open Document — opening another Document rests
   * the sheet at peek.
   */
  protected readonly sheetState = linkedSignal<string | null, string>({
    source: this.docOpen,
    computation: () => 'peek',
  });
  /** The tap's result, for the handle's label. */
  protected readonly sheetLabel = computed(
    () =>
      ({
        half: 'Expand insights panel',
        full: 'Expand insights panel to full screen',
        peek: 'Collapse insights panel',
      })[this.sheet().next().name]!,
  );

  constructor() {
    const config = inject(HOST_CONFIG);
    const zone = inject(NgZone);
    const events = inject(HostBusEvents);
    const bus = inject(HostBus);
    const createAdapter = inject(HOST_BUS_ADAPTER_FACTORY);
    this.guestUrl = inject(DomSanitizer).bypassSecurityTrustResourceUrl(
      // PROTOTYPE (#157): forwards the reader-nudge variant to the Guest.
      `${config.guestOrigin}/?readerNudge=${new URLSearchParams(location.search).get('readerNudge') ?? 'meta'}`,
    );

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
        this.watchPresentation();
      });
    });

    inject(DestroyRef).onDestroy(() => {
      this.unwatchPresentation?.();
      this.unwatchPresentation = null;
      if (this.adapter) bus.detach(this.adapter);
      this.adapter?.dispose();
      this.adapter = null;
    });

    // A landed show-page request (issue #78) rests the sheet at half: the
    // jumped-to page shows above it while the takeaways stay in reach for
    // the next tap. On desktop the detent is inert.
    const pageFocus = inject(PageFocus);
    effect(() => {
      if (pageFocus.landed() !== null) this.sheetState.set('half');
    });

    // A landed expand-panel request (issue #79) lifts a peeking sheet to
    // half — the jump bar can't raise the sheet itself, and there is no
    // sheet in the lane presentation. Untracked reads keep the request
    // one-shot: later detent changes must not replay it.
    const sheetExpand = inject(SheetExpand);
    effect(() => {
      if (sheetExpand.requested() === 0) return;
      untracked(() => {
        if (this.isMobile() && this.sheetState() === 'peek') this.sheetState.set('half');
      });
    });
  }

  /** Whether the frame presents as the mobile sheet — the #77 breakpoint. */
  private isMobile(): boolean {
    return window.matchMedia?.(MOBILE_MEDIA_QUERY)?.matches ?? false;
  }

  /**
   * Reports the lane/sheet presentation (issue #77): once now — the adapter
   * buffers it until GUEST_READY — then on every breakpoint crossing.
   * `matchMedia` fires `change` only on crossings, never per-resize.
   */
  private watchPresentation(): void {
    const media = window.matchMedia?.(MOBILE_MEDIA_QUERY);
    if (!media) return;
    const report = (): void =>
      this.adapter?.setPresentation(media.matches ? 'sheet' : 'lane');
    report();
    media.addEventListener('change', report);
    this.unwatchPresentation = () => media.removeEventListener('change', report);
  }
}
