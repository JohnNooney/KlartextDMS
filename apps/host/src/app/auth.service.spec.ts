import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth.service';
import { FIREBASE_AUTH } from './firebase';
import {
  getRedirectResult,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut,
} from 'firebase/auth';

// Self-contained mock — `importOriginal` doesn't survive the test bundler's
// hoisting. Only the surface AuthService touches is exported.
vi.mock('firebase/auth', () => ({
  AuthErrorCodes: {
    POPUP_BLOCKED: 'auth/popup-blocked',
    POPUP_CLOSED_BY_USER: 'auth/popup-closed-by-user',
  },
  GoogleAuthProvider: class {},
  getRedirectResult: vi.fn(async () => null),
  onAuthStateChanged: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  signInWithPopup: vi.fn(),
  signInWithRedirect: vi.fn(),
  signOut: vi.fn(async () => undefined),
}));

const authStub = { name: 'auth-stub' };

function createService(): AuthService {
  TestBed.configureTestingModule({
    providers: [{ provide: FIREBASE_AUTH, useValue: authStub }],
  });
  return TestBed.inject(AuthService);
}

/** Drive the captured onAuthStateChanged callback as the SDK would. */
function emitUser(user: unknown): void {
  const listener = vi.mocked(onAuthStateChanged).mock.calls[0]![1] as (u: unknown) => void;
  listener(user);
}

describe('AuthService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('waits for the first auth emission before reporting signed-out', () => {
    const service = createService();
    expect(service.user()).toBeUndefined();
    emitUser(null);
    expect(service.user()).toBeNull();
  });

  it('maps the Firebase user to Session-shaped user data', () => {
    const service = createService();
    emitUser({ uid: 'u1', displayName: 'Test User', email: 't@t.dev' });
    expect(service.user()).toEqual({ uid: 'u1', displayName: 'Test User', email: 't@t.dev' });
  });

  it('resolves a pending redirect sign-in on boot', async () => {
    vi.mocked(getRedirectResult).mockResolvedValueOnce({
      user: { uid: 'u2', displayName: 'Redirect', email: 'r@t.dev' },
    } as never);
    const service = createService();
    await Promise.resolve();
    expect(service.user()).toEqual({ uid: 'u2', displayName: 'Redirect', email: 'r@t.dev' });
  });

  it('surfaces a failed redirect sign-in as a gate error', async () => {
    vi.mocked(getRedirectResult).mockRejectedValueOnce(new Error('denied'));
    const service = createService();
    await Promise.resolve();
    await Promise.resolve();
    expect(service.error()).toBeTruthy();
  });

  it('signs in with the Google popup by default', async () => {
    vi.mocked(signInWithPopup).mockResolvedValueOnce({} as never);
    const service = createService();
    await service.signInWithGoogle();
    expect(signInWithPopup).toHaveBeenCalledOnce();
    expect(signInWithRedirect).not.toHaveBeenCalled();
  });

  it('falls back to redirect when the popup is blocked', async () => {
    const blocked = Object.assign(new Error('blocked'), { code: 'auth/popup-blocked' });
    vi.mocked(signInWithPopup).mockRejectedValueOnce(blocked);
    vi.mocked(signInWithRedirect).mockResolvedValueOnce(undefined as never);
    const service = createService();
    await service.signInWithGoogle();
    expect(signInWithRedirect).toHaveBeenCalledOnce();
  });

  it('does not fall back to redirect when the user closes the popup', async () => {
    const closed = Object.assign(new Error('closed'), { code: 'auth/popup-closed-by-user' });
    vi.mocked(signInWithPopup).mockRejectedValueOnce(closed);
    const service = createService();
    await service.signInWithGoogle();
    expect(signInWithRedirect).not.toHaveBeenCalled();
  });

  it('signs in with email and password (emulator path)', async () => {
    vi.mocked(signInWithEmailAndPassword).mockResolvedValueOnce({} as never);
    const service = createService();
    await service.signInWithEmail('test-user@test.com', 'test1234');
    expect(signInWithEmailAndPassword).toHaveBeenCalledWith(
      authStub,
      'test-user@test.com',
      'test1234',
    );
  });

  it('surfaces a failed email sign-in as a gate error', async () => {
    vi.mocked(signInWithEmailAndPassword).mockRejectedValueOnce(
      Object.assign(new Error('nope'), { code: 'auth/invalid-credential' }),
    );
    const service = createService();
    await service.signInWithEmail('a@b.c', 'wrong');
    expect(service.error()).toBeTruthy();
  });

  it('signs out', async () => {
    const service = createService();
    await service.signOut();
    expect(signOut).toHaveBeenCalledWith(authStub);
  });
});
