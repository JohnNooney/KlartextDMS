import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  // The Guest's config is build-time env vars (issue #26): read the repo-root
  // .env so dev picks up KLARTEXT_GUEST_DEBUG_TOKEN; CI injects the same name
  // for e2e/preview builds. KLARTEXT_HOST_* stays out of the Guest bundle.
  envDir: fileURLToPath(new URL('../..', import.meta.url)),
  envPrefix: ['VITE_', 'KLARTEXT_GUEST_'],
  resolve: {
    // Source-level consumption of the shared workspace packages — no build step.
    alias: {
      // Most specific first: a bare-specifier alias also prefix-matches subpaths.
      '@klartext/bus-contract/testing': fileURLToPath(
        new URL('../../packages/bus-contract/src/testing.ts', import.meta.url),
      ),
      '@klartext/bus-contract/conformance': fileURLToPath(
        new URL('../../packages/bus-contract/src/conformance.ts', import.meta.url),
      ),
      '@klartext/bus-contract': fileURLToPath(
        new URL('../../packages/bus-contract/src/index.ts', import.meta.url),
      ),
      '@klartext/firebase-config': fileURLToPath(
        new URL('../../packages/firebase-config/src/index.ts', import.meta.url),
      ),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    cors: true,
  },
});
