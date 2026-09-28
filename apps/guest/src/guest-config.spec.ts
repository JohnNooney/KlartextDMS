import { describe, expect, it } from 'vitest';
import { loadGuestConfig, referrerPeerOrigin } from './guest-config';

describe('loadGuestConfig', () => {
  it('uses the emulators in dev when the flag is unset', () => {
    expect(loadGuestConfig({ DEV: true }).useEmulators).toBe(true);
  });

  it('leaves the emulators off in production builds when the flag is unset', () => {
    expect(loadGuestConfig({ DEV: false }).useEmulators).toBe(false);
  });

  it('honours an explicit VITE_USE_FIREBASE_EMULATORS over the dev default', () => {
    expect(
      loadGuestConfig({ DEV: true, VITE_USE_FIREBASE_EMULATORS: 'false' }).useEmulators,
    ).toBe(false);
    expect(
      loadGuestConfig({ DEV: false, VITE_USE_FIREBASE_EMULATORS: 'true' }).useEmulators,
    ).toBe(true);
  });

  it('exposes the App Check debug token only when injected at build time', () => {
    expect(loadGuestConfig({ DEV: true }).appCheckDebugToken).toBeUndefined();
    expect(
      loadGuestConfig({ DEV: true, KLARTEXT_GUEST_DEBUG_TOKEN: 'tok-1' }).appCheckDebugToken,
    ).toBe('tok-1');
  });

  it('keeps the fake AI provider opt-in only, including in dev', () => {
    expect(loadGuestConfig({ DEV: true }).fakeAiProvider).toBe(false);
    expect(loadGuestConfig({ DEV: true, VITE_FAKE_AI_PROVIDER: 'false' }).fakeAiProvider).toBe(
      false,
    );
    expect(loadGuestConfig({ DEV: true, VITE_FAKE_AI_PROVIDER: 'true' }).fakeAiProvider).toBe(
      true,
    );
    expect(loadGuestConfig({ DEV: false, VITE_FAKE_AI_PROVIDER: 'true' }).fakeAiProvider).toBe(
      true,
    );
  });
});

describe('referrerPeerOrigin', () => {
  it('reduces the embedding page URL to its bare origin', () => {
    expect(referrerPeerOrigin('http://localhost:4200/documents/doc_1')).toBe(
      'http://localhost:4200',
    );
  });

  it('works on hashed preview channel URLs', () => {
    expect(referrerPeerOrigin('https://klartext-host--pr-26-abc123.web.app/')).toBe(
      'https://klartext-host--pr-26-abc123.web.app',
    );
  });

  it('returns null when standalone — no embedding Host', () => {
    expect(referrerPeerOrigin('')).toBeNull();
  });

  it('returns null for an unparseable referrer', () => {
    expect(referrerPeerOrigin('not a url')).toBeNull();
  });
});
