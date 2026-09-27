/**
 * Writes the gitignored `public/assets/config.local.json` — local-only
 * overrides merged over `assets/config.json` at bootstrap. Carries the App
 * Check debug token from the root `.env` (issue #25): the token is never
 * committed and never reaches production builds.
 *
 * Runs automatically via `prestart`; re-run manually after rotating tokens.
 * CI/preview builds write `config.json` directly instead (see the PR preview
 * workflow), so this script never runs there.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const rootEnv = fileURLToPath(new URL('../../../.env', import.meta.url));
const out = fileURLToPath(new URL('../public/assets/config.local.json', import.meta.url));

if (!existsSync(rootEnv)) {
  console.log('[config] no root .env — skipping config.local.json');
  process.exit(0);
}

const env = Object.fromEntries(
  readFileSync(rootEnv, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => line.split('=', 2)),
);

const token = process.env.KLARTEXT_HOST_DEBUG_TOKEN ?? env.KLARTEXT_HOST_DEBUG_TOKEN;
if (!token) {
  console.log('[config] KLARTEXT_HOST_DEBUG_TOKEN unset — skipping config.local.json');
  process.exit(0);
}

writeFileSync(out, `${JSON.stringify({ appCheckDebugToken: token }, null, 2)}\n`);
console.log('[config] wrote assets/config.local.json (App Check debug token)');
