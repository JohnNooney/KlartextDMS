import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  CustomProvider,
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
} from 'firebase/app-check';
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth';
import { appCheckSiteKey, emulatorConfig, firebaseConfig } from '@klartext/firebase-config';
import type { GuestAdapter } from '@klartext/bus-contract/conformance';
import type { GuestConfig } from './guest-config';

/**
 * Guest-side Firebase wiring (issue #26): the shared web-app config, App
 * Check, and Auth. Firestore/Storage are never initialized — the anonymous
 * uid has zero data access; it exists only so App Check attestation and
 * Firebase AI Logic's authenticated mode have a signed-in user (issue #10).
 */
export interface GuestFirebase {
  app: FirebaseApp;
  auth: Auth;
}

declare global {
  // Firebase App Check reads the debug-mode flag off the global object; when
  // set, the configured provider is bypassed for the debug-token exchange.
  var FIREBASE_APPCHECK_DEBUG_TOKEN: string | boolean | undefined;
}

export function initGuestFirebase(config: GuestConfig): GuestFirebase {
  // The debug token is injected as a build-time env var in dev/e2e/preview
  // builds (issue #21); production never carries one. Must precede
  // initializeAppCheck.
  if (config.appCheckDebugToken) {
    self.FIREBASE_APPCHECK_DEBUG_TOKEN = config.appCheckDebugToken;
  }
  const app = initializeApp(firebaseConfig);
  // Unconditional in every Environment — only the provider outcome varies:
  // debug flag set → debug exchange; otherwise reCAPTCHA Enterprise with the
  // project's site key, pinned to the exact prod hostnames (issue #21). In
  // debug mode the SDK exchanges the debug token directly and never consults
  // the provider — but it still runs `provider.initialize()`, which eagerly
  // loads reCAPTCHA (and errors on the empty dev site key). A CustomProvider
  // whose getToken can never fire keeps that script out of dev/preview.
  initializeAppCheck(app, {
    provider: config.appCheckDebugToken
      ? new CustomProvider({
          getToken: () =>
            Promise.reject(new Error('debug mode never asks the provider')),
        })
      : new ReCaptchaEnterpriseProvider(appCheckSiteKey),
    isTokenAutoRefreshEnabled: true,
  });
  const auth = getAuth(app);
  if (config.useEmulators) {
    connectAuthEmulator(auth, `http://${emulatorConfig.host}:${emulatorConfig.auth.port}`, {
      disableWarnings: true,
    });
  }
  return { app, auth };
}

/**
 * The GUEST_READY ordering (issue #10): "ready" means "can accept an
 * Extraction Job", so the Bus adapter announces only after anonymous sign-in
 * resolves. A Guest that can't sign in never readies — the Host's watchdog
 * surfaces it; resolving `false` lets the caller log without retrying (the
 * iframe reload is the retry, and re-signing on every mount is expected).
 */
export async function signInThenReady(
  signIn: () => Promise<unknown>,
  adapter: Pick<GuestAdapter, 'mount'>,
): Promise<boolean> {
  try {
    await signIn();
  } catch (err) {
    console.error('[guest] anonymous sign-in failed — the Guest never readies', err);
    return false;
  }
  adapter.mount();
  return true;
}
