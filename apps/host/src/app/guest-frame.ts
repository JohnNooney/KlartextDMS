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
  private adapter: HostAdapter | null = null;

  protected readonly guestUrl: SafeResourceUrl;
  /** Whether a Document is open — the frame displays only then (#28). */
  protected readonly docOpen = inject(OpenDocument).docId;
  /**
   * Mobile bottom-sheet detent (issue #50): rests at peek so the PDF stays
   * primary, and cycles peek → half → full → peek on handle taps. Linked to
   * the open Document — opening another Document rests the sheet at peek.
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
  /** Chevron pointing where the sheet will move: up to grow, down to rest. */
  protected readonly chevronPath = computed(() =>
    this.nextSheet() === 'peek' ? 'm6 9.5 6 6 6-6' : 'm6 14.5 6-6 6 6',
  );

  protected cycleSheet(): void {
    this.sheetState.set(this.nextSheet());
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
