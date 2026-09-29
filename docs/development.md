# Development internals

Contributor-facing detail that stays out of the README: the e2e Environment
wiring, App Check debug tokens, and the toolchain/port notes.

## E2E

`pnpm e2e` builds both apps for the e2e Environment (`pnpm build:e2e`: Guest
with `VITE_USE_FIREBASE_EMULATORS`/`VITE_FAKE_AI_PROVIDER`, Host `config.json`
pointing at the Guest on :5055) and runs
`firebase emulators:exec --only auth,firestore,storage,hosting "node scripts/seed.mjs && pnpm test:e2e"`.
First run needs `pnpm --filter @klartext/e2e exec playwright install chromium`.
To iterate, keep
`firebase emulators:start --only auth,firestore,storage,hosting` running,
`node scripts/seed.mjs` once, and rerun `pnpm test:e2e` (optionally with a spec
path via `pnpm --filter @klartext/e2e exec playwright test tests/<file>`).

`pnpm screenshots` is the same harness scoped to
`e2e/tests/screenshots.spec.ts`, which rewrites the committed
`docs/screenshots/*.png` shown in the README.

## App Check debug token

`pnpm dev` writes `apps/host/public/assets/config.local.json` (gitignored) from
the root `.env`'s `KLARTEXT_HOST_DEBUG_TOKEN`, which the Host turns into
`self.FIREBASE_APPCHECK_DEBUG_TOKEN` before `initializeAppCheck`; the Guest
takes `KLARTEXT_GUEST_DEBUG_TOKEN` via `vite.config.ts`'s `envDir`/`envPrefix`
(see `.env.example`). Preview builds get them from the same-named GitHub
secrets; production never carries one.

## Node / Angular

The workspace pins Node 24 (`.nvmrc`, `engines`). The Host sits on Angular 21 —
picked when the pin was Node 20, the newest major whose toolchain still
supported it (Angular 22 requires ≥22.22). Bump deliberately.

## macOS ports

The Hosting emulator runs on :5050 (Guest auto-assigned :5055) because the
default :5000 collides with macOS's AirPlay Receiver.

## Sign-in under the emulators

The Email/Password form shows only under `useEmulators` — in production the
allowlist (`allowedEmails`) gates sign-in to the owner's account.
