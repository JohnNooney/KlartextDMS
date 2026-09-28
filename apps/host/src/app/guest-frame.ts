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
import { ExtractionJobs } from './bus/extraction-jobs';
import { HOST_BUS_ADAPTER_FACTORY } from './bus/host-bus.adapter';
import { HostBusEvents } from './bus/host-bus-events';
import { windowBusSource } from './bus/window-bus';
import { HOST_CONFIG } from './host-config';
import { OpenDocument } from './open-document';

/**
 * The Guest's iframe: mounted once after sign-in and kept mounted — hidden —
 * for the whole session so background Extraction Jobs survive navigation
 * (issue #25); it displays only while a Document is open (issue #16). Its
 * `contentWindow` is the Bus sink; `window` is the source. Message listening
 * runs outside the Angular zone so Bus traffic doesn't trigger change
 * detection. The live adapter is exposed to the app as `ExtractionJobs` so
 * the library can cancel a deleted Document's queued/running jobs.
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
  protected readonly docOpen = inject(OpenDocument).id;

  constructor() {
    const config = inject(HOST_CONFIG);
    const zone = inject(NgZone);
    const events = inject(HostBusEvents);
    const jobs = inject(ExtractionJobs);
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
        jobs.attach(this.adapter);
      });
    });

    inject(DestroyRef).onDestroy(() => {
      if (this.adapter) jobs.detach(this.adapter);
      this.adapter?.dispose();
      this.adapter = null;
    });
  }
}
