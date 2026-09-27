import { Component, inject, signal } from '@angular/core';
import { AuthService } from './auth.service';
import { HOST_CONFIG } from './host-config';

/**
 * Full-screen sign-in gate (issue #10 resolution): a centered Klartext card.
 * Google is always offered; the Email/Password form renders only under
 * `useEmulators` — the dev/Playwright path against the emulator seed user.
 */
@Component({
  selector: 'app-sign-in-gate',
  templateUrl: './sign-in-gate.html',
  styleUrl: './sign-in-gate.scss',
})
export class SignInGate {
  protected readonly auth = inject(AuthService);
  protected readonly showEmailForm = inject(HOST_CONFIG).useEmulators;
  protected readonly pending = signal(false);

  protected signInWithGoogle(): void {
    void this.auth.signInWithGoogle();
  }

  protected async submitEmail(
    event: SubmitEvent,
    email: string,
    password: string,
  ): Promise<void> {
    event.preventDefault();
    this.pending.set(true);
    try {
      await this.auth.signInWithEmail(email, password);
    } finally {
      this.pending.set(false);
    }
  }
}
