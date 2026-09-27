import { inject, Injectable, signal } from '@angular/core';
import {
  AuthErrorCodes,
  getRedirectResult,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type User,
} from 'firebase/auth';
import type { SessionUser } from '@klartext/bus-contract';
import { FIREBASE_AUTH } from './firebase';
import { HOST_CONFIG } from './host-config';

/**
 * Host sign-in (issue #10 resolution): Google for humans — popup first,
 * redirect fallback — and Email/Password rendered only under `useEmulators`
 * for dev and the Playwright suite. The signed-in user maps to the Session's
 * `user` payload; identity never crosses the Bus as a credential.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly auth = inject(FIREBASE_AUTH);
  private readonly allowedEmails = inject(HOST_CONFIG).allowedEmails;
  private readonly googleProvider = new GoogleAuthProvider();

  /**
   * The signed-in user as `Session.user` data.
   * `undefined` = still waiting on the first `onAuthStateChanged` emission
   * (the gate shows a spinner); `null` = signed out.
   */
  readonly user = signal<SessionUser | null | undefined>(undefined);
  /** User-safe sign-in failure for the gate; cleared on the next attempt. */
  readonly error = signal<string | null>(null);

  constructor() {
    onAuthStateChanged(this.auth, (user) => this.applyUser(user));
    // Resolve a signInWithRedirect fallback from the previous page load.
    getRedirectResult(this.auth).then(
      (credential) => {
        if (credential?.user) this.applyUser(credential.user);
      },
      () => this.error.set('Sign-in did not complete. Try again.'),
    );
  }

  /**
   * Single funnel for every auth emission: a user outside `allowedEmails`
   * (when configured) is signed straight back out and told so on the gate.
   */
  private applyUser(user: User | null): void {
    if (user !== null && !this.isAllowed(user.email)) {
      this.error.set("This account isn't allowed to sign in.");
      this.user.set(null);
      void signOut(this.auth);
      return;
    }
    this.user.set(user === null ? null : toSessionUser(user));
  }

  private isAllowed(email: string | null): boolean {
    const allowed = this.allowedEmails;
    if (!allowed || allowed.length === 0) return true;
    return email !== null && allowed.some((e) => e.toLowerCase() === email.toLowerCase());
  }

  async signInWithGoogle(): Promise<void> {
    this.error.set(null);
    try {
      await signInWithPopup(this.auth, this.googleProvider);
    } catch (err) {
      // Popup blocked or an environment that can't pop — fall through to the
      // redirect flow. A user-closed popup is a cancel, not a failure.
      if (isRedirectFallback(err)) {
        await signInWithRedirect(this.auth, this.googleProvider);
        return;
      }
      if (!isUserCancel(err)) {
        this.error.set('Sign-in did not complete. Try again.');
      }
    }
  }

  async signInWithEmail(email: string, password: string): Promise<void> {
    this.error.set(null);
    try {
      await signInWithEmailAndPassword(this.auth, email, password);
    } catch {
      this.error.set('Wrong email or password.');
    }
  }

  async signOut(): Promise<void> {
    this.error.set(null);
    await signOut(this.auth);
  }
}

function toSessionUser(user: User): SessionUser {
  return { uid: user.uid, displayName: user.displayName, email: user.email };
}

function isRedirectFallback(err: unknown): boolean {
  const code = (err as { code?: string }).code;
  return (
    code === AuthErrorCodes.POPUP_BLOCKED ||
    code === AuthErrorCodes.OPERATION_NOT_SUPPORTED ||
    code === AuthErrorCodes.WEB_STORAGE_UNSUPPORTED
  );
}

// A user-dismissed or superseded popup is a cancel, not a failure.
function isUserCancel(err: unknown): boolean {
  const code = (err as { code?: string }).code;
  return (
    code === AuthErrorCodes.POPUP_CLOSED_BY_USER || code === AuthErrorCodes.EXPIRED_POPUP_REQUEST
  );
}
