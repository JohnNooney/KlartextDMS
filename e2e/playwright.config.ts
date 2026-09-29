import { readFileSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

// The Hosting emulator port lives in firebase.json — the Host is the first
// site there (:5050); the Guest auto-assigns +5 (:5055, ADR 0004).
const hostingPort = (
  JSON.parse(readFileSync(new URL('../firebase.json', import.meta.url), 'utf8')) as {
    emulators: { hosting: { port: number } };
  }
).emulators.hosting.port;

/**
 * The e2e Environment (issue #34, docs/deployment.md): the built apps served
 * by the Hosting emulator — Host first, Guest in its iframe — against the auth/firestore/storage emulators. The suite never boots
 * servers itself (no `webServer`): run it inside the wrapper,
 *
 *   pnpm e2e   # = build:e2e, then firebase emulators:exec … "seed && pnpm test:e2e"
 *
 * The specs share one seeded emulator, so they run serially in one worker.
 */
export default defineConfig({
  testDir: './tests',
  // screenshots.spec.ts rewrites the committed docs/screenshots/*.png — keep it
  // out of the normal suite (`pnpm e2e`, CI) so a run can't dirty the tree.
  // `pnpm screenshots` sets SCREENSHOTS to opt it back in (issue #52).
  testIgnore: process.env['SCREENSHOTS'] ? undefined : '**/screenshots.spec.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: `http://localhost:${hostingPort}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
