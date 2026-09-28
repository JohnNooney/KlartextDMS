import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AuthService } from './auth.service';
import { GuestFrame } from './guest-frame';
import { OpenDocument } from './open-document';
import { SignInGate } from './sign-in-gate';
import { ToastOutlet } from './toasts/toast-outlet';

// The Host app (issues #25, #28, #29): a sign-in gate until Auth resolves,
// then the app layout — sidebar + the routed Document library/reader — with
// the Guest iframe mounted once for the session and the toast outlet on top.
// The sidebar collapses while a Document is open.
@Component({
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.scss',
  imports: [GuestFrame, RouterOutlet, SignInGate, ToastOutlet],
})
export class App {
  protected readonly auth = inject(AuthService);
  protected readonly user = this.auth.user;
  protected readonly docOpen = inject(OpenDocument).docId;

  protected signOut(): void {
    void this.auth.signOut();
  }
}
