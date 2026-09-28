import { TestBed } from '@angular/core/testing';
import { deleteApp } from 'firebase/app';
import type { FirebaseStorage } from 'firebase/storage';
import type { Firestore } from 'firebase/firestore';
import { afterEach, describe, expect, it } from 'vitest';
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
