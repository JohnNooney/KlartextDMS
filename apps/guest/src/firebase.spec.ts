import { deleteApp, type FirebaseApp } from 'firebase/app';
import type { Auth } from 'firebase/auth';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initGuestFirebase, signInThenReady } from './firebase';
import type { GuestConfig } from './guest-config';

const BASE: GuestConfig = {
  useEmulators: true,
  appCheckDebugToken: 'debug-token-1',
  fakeAiProvider: false,
};

describe('initGuestFirebase', () => {
  const initialized: { app: FirebaseApp }[] = [];

  afterEach(async () => {
    delete self.FIREBASE_APPCHECK_DEBUG_TOKEN;
    document.getElementById('fire_app_check_[DEFAULT]')?.remove();
    vi.restoreAllMocks();
    for (const { app } of initialized) await deleteApp(app);
    initialized.length = 0;
  });

  function init(config: GuestConfig): { app: FirebaseApp; auth: Auth } {
    const firebase = initGuestFirebase(config);
    initialized.push(firebase);
    return firebase;
  }

  it('sets the App Check debug flag before initialization when a debug token is configured', () => {
    init(BASE);
    expect(self.FIREBASE_APPCHECK_DEBUG_TOKEN).toBe('debug-token-1');
  });

  it('leaves the debug flag unset without a configured token', () => {
    init({ ...BASE, appCheckDebugToken: undefined });
    expect(self.FIREBASE_APPCHECK_DEBUG_TOKEN).toBeUndefined();
  });

  it('initializes App Check via the debug provider when a token is configured', () => {
    const { app } = init(BASE);
    expect(appCheckInitialized(app)).toBe(true);
  });

  it('skips App Check under the emulators without a debug token', () => {
    const { app } = init({ ...BASE, appCheckDebugToken: undefined });
    expect(appCheckContainer()).toBeNull();
    expect(appCheckInitialized(app)).toBe(false);
  });

  it('initializes App Check with the site key against a real backend', () => {
    init({ ...BASE, useEmulators: false, appCheckDebugToken: undefined });
    expect(appCheckContainer()).not.toBeNull();
  });

  it('connects Auth to the emulator under useEmulators', () => {
    const { auth } = init(BASE);
    expect(auth.emulatorConfig?.host).toBe('localhost');
  });

  it('leaves Auth pointed at production without useEmulators', () => {
    const { auth } = init({ ...BASE, useEmulators: false });
    expect(auth.emulatorConfig).toBeNull();
  });
});

// App Check marks itself by appending an invisible container div when a
// reCAPTCHA provider initializes — absent when the SDK was never initialized
// or the CustomProvider (debug mode) is in play.
function appCheckContainer(): HTMLElement | null {
  return document.getElementById('fire_app_check_[DEFAULT]');
}

// `getAppCheck` isn't exported in this SDK version — reach into the app's
// component registry.
function appCheckInitialized(app: FirebaseApp): boolean {
  const container = (
    app as unknown as {
      container: { getProvider(name: string): { isInitialized(): boolean } };
    }
  ).container;
  return container.getProvider('app-check').isInitialized();
}

describe('signInThenReady', () => {
  it('announces GUEST_READY only after anonymous sign-in resolves', async () => {
    const order: string[] = [];
    let resolveSignIn!: () => void;
    const signIn = () =>
      new Promise<void>((resolve) => {
        resolveSignIn = () => {
          order.push('sign-in');
          resolve();
        };
      });
    const adapter = { mount: vi.fn(() => order.push('mount')) };

    const pending = signInThenReady(signIn, adapter);
    expect(adapter.mount).not.toHaveBeenCalled();
    resolveSignIn();
    await expect(pending).resolves.toBe(true);
    expect(order).toEqual(['sign-in', 'mount']);
  });

  it('never readies when sign-in fails — the Host watchdog surfaces it', async () => {
    const adapter = { mount: vi.fn() };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      signInThenReady(() => Promise.reject(new Error('auth down')), adapter),
    ).resolves.toBe(false);
    expect(adapter.mount).not.toHaveBeenCalled();
  });
});
