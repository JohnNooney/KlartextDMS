import { TestBed } from '@angular/core/testing';
import { deleteApp } from 'firebase/app';
import type { FirebaseStorage } from 'firebase/storage';
import type { Firestore } from 'firebase/firestore';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FIREBASE_APP,
  FIREBASE_AUTH,
  FIREBASE_FIRESTORE,
  FIREBASE_STORAGE,
  provideKlartextFirebase,
} from './firebase';
import { HOST_CONFIG, type HostConfig } from './host-config';

function setup(config: HostConfig): void {
  TestBed.configureTestingModule({
    providers: [{ provide: HOST_CONFIG, useValue: config }, ...provideKlartextFirebase()],
  });
}

describe('provideKlartextFirebase', () => {
  afterEach(async () => {
    delete self.FIREBASE_APPCHECK_DEBUG_TOKEN;
    document.getElementById('fire_app_check_[DEFAULT]')?.remove();
    vi.restoreAllMocks();
    await deleteApp(TestBed.inject(FIREBASE_APP));
  });

  it('sets the App Check debug flag before initialization when a debug token is configured', () => {
    setup({
      guestOrigin: 'http://localhost:5173',
      useEmulators: true,
      appCheckDebugToken: 'debug-token-1',
    });
    TestBed.inject(FIREBASE_APP);
    expect(self.FIREBASE_APPCHECK_DEBUG_TOKEN).toBe('debug-token-1');
  });

  it('leaves the debug flag unset without a configured token', () => {
    setup({ guestOrigin: 'https://guest.web.app', useEmulators: false });
    TestBed.inject(FIREBASE_APP);
    expect(self.FIREBASE_APPCHECK_DEBUG_TOKEN).toBeUndefined();
  });

  it('initializes App Check when a site key is configured', () => {
    setup({
      guestOrigin: 'https://guest.web.app',
      useEmulators: false,
      appCheckSiteKey: 'site-key-1',
    });
    TestBed.inject(FIREBASE_APP);
    expect(appCheckContainer()).not.toBeNull();
  });

  it('skips App Check entirely without a credential (local emulator dev)', () => {
    setup({ guestOrigin: 'http://localhost:5173', useEmulators: true });
    TestBed.inject(FIREBASE_APP);
    expect(appCheckContainer()).toBeNull();
  });

  it('warns when a real-backend config carries no App Check credential', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setup({ guestOrigin: 'https://guest.web.app', useEmulators: false });
    TestBed.inject(FIREBASE_APP);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[app-check]'));
    expect(appCheckContainer()).toBeNull();
  });

  it('overrides the Auth domain when configured', () => {
    setup({
      guestOrigin: 'https://klartext-guest.nooney.dev',
      useEmulators: false,
      authDomain: 'klartext.nooney.dev',
    });
    expect(TestBed.inject(FIREBASE_APP).options.authDomain).toBe('klartext.nooney.dev');
  });

  it('provides Auth — connected to the emulator under useEmulators', () => {
    setup({
      guestOrigin: 'http://localhost:5173',
      useEmulators: true,
      appCheckDebugToken: 't',
    });
    const auth = TestBed.inject(FIREBASE_AUTH);
    expect(auth.emulatorConfig?.host).toBe('localhost');
  });

  it('leaves Auth pointed at production without useEmulators', () => {
    setup({ guestOrigin: 'https://guest.web.app', useEmulators: false });
    const auth = TestBed.inject(FIREBASE_AUTH);
    expect(auth.emulatorConfig).toBeNull();
  });

  it('provides Firestore — connected to the emulator under useEmulators', () => {
    setup({
      guestOrigin: 'http://localhost:5173',
      useEmulators: true,
      appCheckDebugToken: 't',
    });
    const firestore = TestBed.inject(FIREBASE_FIRESTORE);
    expect(firestoreHost(firestore)).toBe('localhost:8080');
  });

  it('leaves Firestore pointed at production without useEmulators', () => {
    setup({ guestOrigin: 'https://guest.web.app', useEmulators: false });
    const firestore = TestBed.inject(FIREBASE_FIRESTORE);
    expect(firestoreHost(firestore)).toBe('firestore.googleapis.com');
  });

  it('provides Storage — connected to the emulator under useEmulators', () => {
    setup({
      guestOrigin: 'http://localhost:5173',
      useEmulators: true,
      appCheckDebugToken: 't',
    });
    const storage = TestBed.inject(FIREBASE_STORAGE);
    expect(storageHost(storage)).toBe('localhost:9199');
  });

  it('leaves Storage pointed at production without useEmulators', () => {
    setup({ guestOrigin: 'https://guest.web.app', useEmulators: false });
    const storage = TestBed.inject(FIREBASE_STORAGE);
    expect(storageHost(storage)).toBe('firebasestorage.googleapis.com');
  });
});

// App Check marks itself by appending an invisible container div when a
// reCAPTCHA provider initializes — absent when the SDK was never initialized.
function appCheckContainer(): HTMLElement | null {
  return document.getElementById('fire_app_check_[DEFAULT]');
}

// `Firestore` exposes its settings only through the JSON-serializable dump —
// the SDK's own equivalent of `Auth.emulatorConfig`.
function firestoreHost(firestore: Firestore): string | undefined {
  return (firestore.toJSON() as { settings?: { host?: string } }).settings?.host;
}

// `FirebaseStorage` keeps its (public-in-runtime, untyped) `host` getter out
// of the published interface — reach for it the way `Auth.emulatorConfig`
// would.
function storageHost(storage: FirebaseStorage): string {
  return (storage as unknown as { host: string }).host;
}
