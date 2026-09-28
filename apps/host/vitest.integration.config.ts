import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

// Emulator-backed specs (issue #27): run inside `firebase emulators:exec`
// via `pnpm test:integration`, which supplies the live Firestore, Storage,
// and Auth emulators. Mirrors the Guest's integration config (issue #26).
export default defineConfig({
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
    // Node, not jsdom: the Storage SDK's resumable uploads need real
    // fetch/XHR, which jsdom's stub XHR can't perform (`storage/unknown`).
    // Firestore, Auth, Blob, and File all work natively in Node.
    environment: 'node',
    // Serial file execution: the rules suite reloads the committed rules into
    // the shared emulator, and the repository suites share one owner subtree.
    fileParallelism: false,
    include: ['src/**/*.integration.spec.ts'],
    // Long enough for the first Firestore/Storage handshake against the
    // emulators; suites themselves are fast once warmed.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
