/// <reference types="vite/client" />

// Build-time env vars the Guest reads (see guest-config.ts). Exposed by
// vite.config.ts's envDir/envPrefix: VITE_* plus the KLARTEXT_GUEST_ prefix —
// the App Check debug token rides in as KLARTEXT_GUEST_DEBUG_TOKEN from the
// repo-root .env (dev) or CI secrets (e2e/preview); never production.
interface ImportMetaEnv {
  readonly VITE_USE_FIREBASE_EMULATORS?: string;
  readonly VITE_FAKE_AI_PROVIDER?: string;
  readonly KLARTEXT_GUEST_DEBUG_TOKEN?: string;
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>;
  export default component;
}
