/**
 * Guest runtime config (issue #26). Unlike the Host there is no fetched
 * `config.json` — the Guest learns its Peer Origin from `document.referrer`
 * at runtime (works on hashed preview channels, ADR 0004), and everything
 * else is a build-time `import.meta.env` var (`vite.config.ts` exposes the
 * `VITE_` and `KLARTEXT_GUEST_` prefixes against the repo-root `.env`).
 */
export interface GuestConfig {
  /**
   * Connect Auth to the local emulator suite. `VITE_USE_FIREBASE_EMULATORS`
   * wins when set (e2e builds set `true`); otherwise dev serves assume
   * emulators and builds assume real Firebase.
   */
  useEmulators: boolean;
  /**
   * App Check debug token — sets `self.FIREBASE_APPCHECK_DEBUG_TOKEN` before
   * `initializeAppCheck`. Injected from `KLARTEXT_GUEST_DEBUG_TOKEN` in
   * dev/e2e/preview builds only; never in production (issue #21).
   */
  appCheckDebugToken?: string;
  /**
   * Serve Extractions from the seeded fixtures instead of calling Gemini
   * (issue #30). Opt-in only — dev defaults to the real model so a genuine
   * Gemini round-trip stays one flag away; e2e builds set `true`.
   */
  fakeAiProvider: boolean;
}

/** The slice of `import.meta.env` the Guest reads — injectable for tests. */
export interface GuestEnv {
  DEV: boolean;
  VITE_USE_FIREBASE_EMULATORS?: string;
  VITE_FAKE_AI_PROVIDER?: string;
  KLARTEXT_GUEST_DEBUG_TOKEN?: string;
}

export function loadGuestConfig(env: GuestEnv): GuestConfig {
  const emulators = env.VITE_USE_FIREBASE_EMULATORS;
  return {
    useEmulators: emulators === undefined || emulators === '' ? env.DEV : emulators === 'true',
    appCheckDebugToken: env.KLARTEXT_GUEST_DEBUG_TOKEN || undefined,
    fakeAiProvider: env.VITE_FAKE_AI_PROVIDER === 'true',
  };
}

/**
 * The Host's origin, read off the Guest document's referrer — the embedding
 * page's URL reduced to its origin. `null` when the Guest runs standalone
 * (empty referrer) so the caller can skip Bus wiring entirely.
 */
export function referrerPeerOrigin(referrer: string): string | null {
  if (!referrer) return null;
  try {
    return new URL(referrer).origin;
  } catch {
    return null;
  }
}
