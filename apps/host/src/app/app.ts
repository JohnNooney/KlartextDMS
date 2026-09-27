import { Component, inject } from '@angular/core';
import { AuthService } from './auth.service';
import { GuestFrame } from './guest-frame';
import { SignInGate } from './sign-in-gate';

// The Host app (issue #25): a sign-in gate until Auth resolves, then the app
// layout — sidebar + main regions — with the Guest iframe mounted once for
// the session.
@Component({
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.scss',
  imports: [GuestFrame, SignInGate],
})
export class App {
  protected readonly auth = inject(AuthService);
  protected readonly user = this.auth.user;

  protected signOut(): void {
    void this.auth.signOut();
  }
}
