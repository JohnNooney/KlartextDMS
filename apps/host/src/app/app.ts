import { Component, inject } from '@angular/core';
import { DomSanitizer, type SafeResourceUrl } from '@angular/platform-browser';
import { HOST_CONFIG } from './host-config';

// Host shell scaffold — sign-in gate, library, and Bus adapter land with the
// Host shell issue (#25). For now the Guest iframe mounts straight away.
@Component({
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly guestUrl: SafeResourceUrl;

  constructor() {
    const config = inject(HOST_CONFIG);
    this.guestUrl = inject(DomSanitizer).bypassSecurityTrustResourceUrl(config.guestOrigin);
  }
}
