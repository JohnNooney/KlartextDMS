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
}

export const HOST_CONFIG = new InjectionToken<HostConfig>('HOST_CONFIG');
