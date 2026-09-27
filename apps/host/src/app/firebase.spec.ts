import { TestBed } from '@angular/core/testing';
import { deleteApp } from 'firebase/app';
import { afterEach, describe, expect, it } from 'vitest';
import { FIREBASE_APP, FIREBASE_AUTH, provideKlartextFirebase } from './firebase';
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
});
