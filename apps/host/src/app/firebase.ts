import { inject, InjectionToken, type Provider } from '@angular/core';
import { initializeApp, type FirebaseApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth';
import { emulatorConfig, firebaseConfig } from '@klartext/firebase-config';
import { HOST_CONFIG } from './host-config';

/**
 * Host-side Firebase wiring (issue #25): the shared web-app config from
 * `@klartext/firebase-config`, App Check, and Auth — the only Firebase
 * services the Host touches in this issue; Firestore/Storage connect with
 * the document repositories (#27).
 */
export const FIREBASE_APP = new InjectionToken<FirebaseApp>('FIREBASE_APP');
export const FIREBASE_AUTH = new InjectionToken<Auth>('FIREBASE_AUTH');

declare global {
  // Firebase App Check reads the debug-mode flag off the global object; when
  // set, the configured provider is bypassed for the debug-token exchange.
  var FIREBASE_APPCHECK_DEBUG_TOKEN: string | boolean | undefined;
}

export function provideKlartextFirebase(): Provider[] {
  return [
    {
      provide: FIREBASE_APP,
      useFactory: () => {
        const config = inject(HOST_CONFIG);
        // The debug token arrives via `appCheckDebugToken` (dev's
        // config.local.json / the preview build's generated config.json);
        // production never carries one. Must precede initializeAppCheck.
        if (config.appCheckDebugToken) {
          self.FIREBASE_APPCHECK_DEBUG_TOKEN = config.appCheckDebugToken;
        }
        const app = initializeApp(firebaseConfig);
        // Unconditional in every Environment (issue #21) — only the provider
        // outcome varies: debug flag set → debug exchange; otherwise
        // reCAPTCHA Enterprise with the hostname-pinned site key.
        if (!config.useEmulators && !config.appCheckSiteKey && !config.appCheckDebugToken) {
          console.warn(
            '[app-check] no reCAPTCHA site key and no debug token — ' +
              'attestation will fail until the site key is provisioned',
          );
        }
        initializeAppCheck(app, {
          provider: new ReCaptchaEnterpriseProvider(config.appCheckSiteKey ?? ''),
          isTokenAutoRefreshEnabled: true,
        });
        return app;
      },
    },
    {
      provide: FIREBASE_AUTH,
      useFactory: () => {
        const config = inject(HOST_CONFIG);
        const auth = getAuth(inject(FIREBASE_APP));
        if (config.useEmulators) {
          connectAuthEmulator(
            auth,
            `http://${emulatorConfig.host}:${emulatorConfig.auth.port}`,
            { disableWarnings: true },
          );
        }
        return auth;
      },
    },
  ];
}
