/**
 * Builds both apps for the e2e Environment (issue #34, docs/deployment.md):
 * the output the Hosting emulator serves under `pnpm e2e`.
 *
 * - Guest: `VITE_USE_FIREBASE_EMULATORS=true` + `VITE_FAKE_AI_PROVIDER=true`
 *   build-time flags — emulator Auth and deterministic, offline Extractions.
 * - Host: the normal build, then the e2e `assets/config.json` written into
 *   the build output (never the committed source file): Guest Peer Origin
 *   (Hosting port + 5), emulators on, and the App Check debug token when one is available
 *   (`KLARTEXT_HOST_DEBUG_TOKEN` from the env — CI secret — or the root .env).
 *   The dev `config.local.json` overlay is dropped from the output so the e2e
 *   config is the only one in play.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const hostAssets = fileURLToPath(new URL('../apps/host/dist/host/browser/assets/', import.meta.url));

const firebaseJson = JSON.parse(readFileSync(new URL('../firebase.json', import.meta.url), 'utf8'));
// Host is the first Hosting site (configured port); firebase-tools assigns
// the second site port + 5 (ADR 0004).
const GUEST_ORIGIN = `http://localhost:${firebaseJson.emulators.hosting.port + 5}`;

function run(filter, env = {}) {
  const result = spawnSync('pnpm', ['--filter', filter, 'build'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function rootEnv(name) {
  if (process.env[name]) return process.env[name];
  const file = fileURLToPath(new URL('../.env', import.meta.url));
  if (!existsSync(file)) return undefined;
  const line = readFileSync(file, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith(`${name}=`));
  return line?.slice(name.length + 1) || undefined;
}

run('@klartext/guest', { VITE_USE_FIREBASE_EMULATORS: 'true', VITE_FAKE_AI_PROVIDER: 'true' });
run('@klartext/host');

const config = { guestOrigin: GUEST_ORIGIN, useEmulators: true };
const token = rootEnv('KLARTEXT_HOST_DEBUG_TOKEN');
if (token) config.appCheckDebugToken = token;
writeFileSync(`${hostAssets}config.json`, `${JSON.stringify(config, null, 2)}\n`);
rmSync(`${hostAssets}config.local.json`, { force: true });
console.log(`[e2e] Host config.json → guestOrigin ${GUEST_ORIGIN}, emulators on`);
