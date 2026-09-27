// Runs under `pnpm test:integration` — inside `firebase emulators:exec`, so
// the Auth emulator is live (issue #26). Verifies the Guest's sign-in path
// end to end: anonymous sign-in against the emulator, then GUEST_READY.
import { deleteApp } from 'firebase/app';
import { signInAnonymously } from 'firebase/auth';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initGuestFirebase, signInThenReady } from './firebase';

describe('Guest anonymous sign-in (emulator)', () => {
  afterEach(() => {
    delete self.FIREBASE_APPCHECK_DEBUG_TOKEN;
  });

  it('signs in anonymously and only then announces GUEST_READY', async () => {
    const { app, auth } = initGuestFirebase({
      useEmulators: true,
      // A debug token keeps App Check on the REST provider in jsdom — the
      // reCAPTCHA provider never settles outside a real browser. The exchange
      // rejects on the bogus token and Auth proceeds without one (emulators
      // don't enforce App Check).
      appCheckDebugToken: 'integration-fake-token',
    });
    try {
      const adapter = { mount: vi.fn() };
      await expect(
        signInThenReady(() => signInAnonymously(auth), adapter),
      ).resolves.toBe(true);
      expect(auth.currentUser?.isAnonymous).toBe(true);
      expect(adapter.mount).toHaveBeenCalledOnce();
    } finally {
      await deleteApp(app);
    }
  });
});
