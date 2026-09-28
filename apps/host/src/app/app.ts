import { Component, inject } from '@angular/core';
import { AuthService } from './auth.service';
import { GuestFrame } from './guest-frame';
import { Library } from './library/library';
import { SignInGate } from './sign-in-gate';
import { ToastOutlet } from './toasts/toast-outlet';

// The Host app (issues #25, #28): a sign-in gate until Auth resolves, then the
// app layout — sidebar + Document library — with the Guest iframe mounted once
// for the session and the toast outlet on top.
@Component({
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.scss',
  imports: [GuestFrame, Library, SignInGate, ToastOutlet],
})
export class App {
  protected readonly auth = inject(AuthService);
  protected readonly user = this.auth.user;

  protected signOut(): void {
    void this.auth.signOut();
  }
}
