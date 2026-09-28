import { inject, Injectable, InjectionToken, signal } from '@angular/core';
import {
  AuthErrorCodes,
  getRedirectResult,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type Auth,
  type AuthProvider,
  type Unsubscribe,
  type User,
  type UserCredential,
} from 'firebase/auth';
import type { SessionUser } from '@klartext/bus-contract';
import { FIREBASE_AUTH } from './firebase';
import { HOST_CONFIG } from './host-config';

/**
 * The `firebase/auth` function surface the service calls, behind DI so specs
 * substitute fakes instead of `vi.mock` — module mocks can't reliably
 * intercept imports that the unit-test bundler places in shared chunks.
 */
export interface AuthActions {
  onAuthStateChanged(auth: Auth, next: (user: User | null) => void): Unsubscribe;
  getRedirectResult(auth: Auth): Promise<UserCredential | null>;
  signInWithEmailAndPassword(
    auth: Auth,
    email: string,
    password: string,
  ): Promise<UserCredential>;
  signInWithPopup(auth: Auth, provider: AuthProvider): Promise<UserCredential>;
  signInWithRedirect(auth: Auth, provider: AuthProvider): Promise<never>;
  signOut(auth: Auth): Promise<void>;
}

export const AUTH_ACTIONS = new InjectionToken<AuthActions>('AUTH_ACTIONS', {
  providedIn: 'root',
  factory: () => ({
    onAuthStateChanged,
    getRedirectResult,
    signInWithEmailAndPassword,
    signInWithPopup,
    signInWithRedirect,
    signOut,
  }),
});

/**
 * Host sign-in (issue #10 resolution): Google for humans — popup first,
 * redirect fallback — and Email/Password rendered only under `useEmulators`
 * for dev and the Playwright suite. The signed-in user maps to the Session's
 * `user` payload; identity never crosses the Bus as a credential.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly auth = inject(FIREBASE_AUTH);
  private readonly actions = inject(AUTH_ACTIONS);
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
    this.actions.onAuthStateChanged(this.auth, (user) => this.applyUser(user));
    // Resolve a signInWithRedirect fallback from the previous page load.
    this.actions.getRedirectResult(this.auth).then(
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
      void this.actions.signOut(this.auth);
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
      await this.actions.signInWithPopup(this.auth, this.googleProvider);
    } catch (err) {
      // Popup blocked or an environment that can't pop — fall through to the
      // redirect flow. A user-closed popup is a cancel, not a failure.
      if (isRedirectFallback(err)) {
        await this.actions.signInWithRedirect(this.auth, this.googleProvider);
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
      await this.actions.signInWithEmailAndPassword(this.auth, email, password);
    } catch {
      this.error.set('Wrong email or password.');
    }
  }

  async signOut(): Promise<void> {
    this.error.set(null);
    await this.actions.signOut(this.auth);
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
