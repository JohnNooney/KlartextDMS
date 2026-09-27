import {
  afterNextRender,
  Component,
  DestroyRef,
  ElementRef,
  inject,
  NgZone,
  viewChild,
} from '@angular/core';
import { DomSanitizer, type SafeResourceUrl } from '@angular/platform-browser';
import type { HostAdapter } from '@klartext/bus-contract/conformance';
import { HOST_BUS_ADAPTER_FACTORY } from './bus/host-bus.adapter';
import { HostBusEvents } from './bus/host-bus-events';
import { windowBusSource } from './bus/window-bus';
import { HOST_CONFIG } from './host-config';

/**
 * The Guest's iframe: mounted once after sign-in and kept mounted — hidden —
 * for the whole session so background Extraction Jobs survive navigation
 * (issue #25). Its `contentWindow` is the Bus sink; `window` is the source.
 * Message listening runs outside the Angular zone so Bus traffic doesn't
 * trigger change detection.
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

  constructor() {
    const config = inject(HOST_CONFIG);
    const zone = inject(NgZone);
    const events = inject(HostBusEvents);
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
      });
    });

    inject(DestroyRef).onDestroy(() => {
      this.adapter?.dispose();
      this.adapter = null;
    });
  }
}
