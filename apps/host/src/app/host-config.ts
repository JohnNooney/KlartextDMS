import { InjectionToken } from '@angular/core';

/**
 * Runtime Environment config for the Host, fetched from `assets/config.json`
 * before bootstrap (ADR 0004). The file's contents vary per Environment; CI
 * rewrites it for preview channels.
 */
export interface HostConfig {
  /** The Guest's origin — iframe `src` and the Bus's `targetOrigin`/origin check. */
  guestOrigin: string;
  /** Connect the Firebase SDKs to the local emulator suite. */
  useEmulators: boolean;
  /**
   * reCAPTCHA Enterprise site key, pinned to the production Host hostnames
   * (issue #21). Absent outside production.
   */
  appCheckSiteKey?: string;
  /**
   * App Check debug token — sets `self.FIREBASE_APPCHECK_DEBUG_TOKEN` before
   * `initializeAppCheck` (issue #25). Dev/preview builds only; never committed,
   * injected from `KLARTEXT_HOST_DEBUG_TOKEN` (see `scripts/write-local-config.mjs`).
   */
  appCheckDebugToken?: string;
}

export const HOST_CONFIG = new InjectionToken<HostConfig>('HOST_CONFIG');
