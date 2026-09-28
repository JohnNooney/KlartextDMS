import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi, type Mock } from 'vitest';
import { GoogleAuthProvider, type User } from 'firebase/auth';
import { AuthService, AUTH_ACTIONS, type AuthActions } from './auth.service';
import { FIREBASE_AUTH } from './firebase';
import { HOST_CONFIG, type HostConfig } from './host-config';

const authStub = { name: 'auth-stub' };

// The auth surface as DI fakes — `vi.mock` can't reliably intercept imports
// that the unit-test bundler places in shared chunks.
function fakeActions(): { [K in keyof AuthActions]: Mock<AuthActions[K]> } {
  return {
    onAuthStateChanged: vi.fn(),
    getRedirectResult: vi.fn(async () => null),
    signInWithEmailAndPassword: vi.fn(),
    signInWithPopup: vi.fn(),
    signInWithRedirect: vi.fn(),
    signOut: vi.fn(async () => undefined),
  };
}

function createService(
  config?: Partial<HostConfig>,
  configure?: (actions: ReturnType<typeof fakeActions>) => void,
) {
  const actions = fakeActions();
  // Runs before inject — constructor calls like getRedirectResult read the fake.
  configure?.(actions);
  TestBed.configureTestingModule({
    providers: [
      { provide: FIREBASE_AUTH, useValue: authStub },
      { provide: AUTH_ACTIONS, useValue: actions },
      {
        provide: HOST_CONFIG,
        useValue: { guestOrigin: 'http://localhost:5173', useEmulators: true, ...config },
      },
    ],
  });
  const service = TestBed.inject(AuthService);
  return { service, actions };
}

/** Drive the captured onAuthStateChanged callback as the SDK would. */
function emitUser(actions: ReturnType<typeof fakeActions>, user: User | null): void {
  const listener = actions.onAuthStateChanged.mock.calls[0]![1];
  listener(user);
}

describe('AuthService', () => {
  it('waits for the first auth emission before reporting signed-out', () => {
    const { service, actions } = createService();
    expect(service.user()).toBeUndefined();
    emitUser(actions, null);
    expect(service.user()).toBeNull();
  });

  it('maps the Firebase user to Session-shaped user data', () => {
    const { service, actions } = createService();
    emitUser(actions, { uid: 'u1', displayName: 'Test User', email: 't@t.dev' } as User);
    expect(service.user()).toEqual({ uid: 'u1', displayName: 'Test User', email: 't@t.dev' });
  });

  it('resolves a pending redirect sign-in on boot', async () => {
    const { service } = createService(undefined, (actions) =>
      actions.getRedirectResult.mockResolvedValueOnce({
        user: { uid: 'u2', displayName: 'Redirect', email: 'r@t.dev' },
      } as never),
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(service.user()).toEqual({ uid: 'u2', displayName: 'Redirect', email: 'r@t.dev' });
  });

  it('surfaces a failed redirect sign-in as a gate error', async () => {
    const { service } = createService(undefined, (actions) =>
      actions.getRedirectResult.mockRejectedValueOnce(new Error('denied')),
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(service.error()).toBeTruthy();
  });

  it('signs in with the Google popup by default', async () => {
    const { service, actions } = createService();
    actions.signInWithPopup.mockResolvedValueOnce({} as never);
    await service.signInWithGoogle();
    expect(actions.signInWithPopup).toHaveBeenCalledWith(
      authStub,
      expect.any(GoogleAuthProvider),
    );
    expect(actions.signInWithRedirect).not.toHaveBeenCalled();
  });

  it('falls back to redirect when the popup is blocked', async () => {
    const { service, actions } = createService();
    actions.signInWithPopup.mockRejectedValueOnce(
      Object.assign(new Error('blocked'), { code: 'auth/popup-blocked' }),
    );
    actions.signInWithRedirect.mockResolvedValueOnce(undefined as never);
    await service.signInWithGoogle();
    expect(actions.signInWithRedirect).toHaveBeenCalledOnce();
  });

  it('does not fall back to redirect when the user closes the popup', async () => {
    const { service, actions } = createService();
    actions.signInWithPopup.mockRejectedValueOnce(
      Object.assign(new Error('closed'), { code: 'auth/popup-closed-by-user' }),
    );
    await service.signInWithGoogle();
    expect(actions.signInWithRedirect).not.toHaveBeenCalled();
    // A user-closed popup is a cancel — no gate error either.
    expect(service.error()).toBeNull();
  });

  it('signs in with email and password (emulator path)', async () => {
    const { service, actions } = createService();
    actions.signInWithEmailAndPassword.mockResolvedValueOnce({} as never);
    await service.signInWithEmail('test-user@test.com', 'test1234');
    expect(actions.signInWithEmailAndPassword).toHaveBeenCalledWith(
      authStub,
      'test-user@test.com',
      'test1234',
    );
  });

  it('surfaces a failed email sign-in as a gate error', async () => {
    const { service, actions } = createService();
    actions.signInWithEmailAndPassword.mockRejectedValueOnce(
      Object.assign(new Error('nope'), { code: 'auth/invalid-credential' }),
    );
    await service.signInWithEmail('a@b.c', 'wrong');
    expect(service.error()).toBeTruthy();
  });

  it('signs out', async () => {
    const { service, actions } = createService();
    await service.signOut();
    expect(actions.signOut).toHaveBeenCalledWith(authStub);
  });

  describe('allowedEmails', () => {
    it('lets any signed-in user through when no allowlist is configured', () => {
      const { service, actions } = createService();
      emitUser(actions, { uid: 'u9', displayName: null, email: 'anyone@example.com' } as User);
      expect(service.user()?.uid).toBe('u9');
      expect(actions.signOut).not.toHaveBeenCalled();
    });

    it('signs a non-allowlisted user straight back out with a gate error', () => {
      const { service, actions } = createService({
        allowedEmails: ['johnnoon74@gmail.com'],
      });
      emitUser(actions, { uid: 'u9', displayName: null, email: 'anyone@example.com' } as User);
      expect(actions.signOut).toHaveBeenCalledWith(authStub);
      expect(service.user()).toBeNull();
      expect(service.error()).toBeTruthy();
    });

    it('lets the allowlisted user through (case-insensitive)', () => {
      const { service, actions } = createService({
        allowedEmails: ['johnnoon74@gmail.com'],
      });
      emitUser(actions, { uid: 'u9', displayName: null, email: 'JohnNoon74@gmail.com' } as User);
      expect(service.user()?.uid).toBe('u9');
      expect(actions.signOut).not.toHaveBeenCalled();
    });
  });
});
