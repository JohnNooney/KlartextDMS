import { fileURLToPath, URL } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

// Emulator-backed specs (issue #26): run inside `firebase emulators:exec`
// via `pnpm test:integration`, which supplies the live Auth emulator.
export default defineConfig({
  plugins: [vue()],
  resolve: {
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
  test: {
    environment: 'jsdom',
    include: ['src/**/*.integration.spec.ts'],
  },
});
