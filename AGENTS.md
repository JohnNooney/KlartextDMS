# KlartextDMS

## Agent skills

### Issue tracker

Issues and specs live in this repo's GitHub Issues (`JohnNooney/KlartextDMS`), managed via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default canonical labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Verification

- `pnpm typecheck`, `pnpm test` (unit), `pnpm test:integration` (emulators + seed).
- Single Host spec: `pnpm --filter @klartext/host exec ng test --include <path>`.
- E2E: `pnpm e2e` (e2e builds → `firebase emulators:exec` → seed → Playwright). To iterate: `pnpm build:e2e`, keep `firebase emulators:start --only auth,firestore,storage,hosting` running, `node scripts/seed.mjs`, then `pnpm --filter @klartext/e2e exec playwright test tests/<file>`. Rebuild after app changes — Hosting serves `dist/`.
- Hosting emulator is on :5050 (Guest :5055); :5000 is taken by macOS AirPlay.
- Windows: the Firestore emulator JVM can outlive `firebase emulators:exec`, so the next run fails with "port 8080 taken". Stop the orphaned `cloud-firestore-emulator` java process holding :8080 before re-running.
- Host integration specs that need Angular DI (e.g. `bus/batch-reanalysis.integration.spec.ts`) run under `// @vitest-environment jsdom`, where Firestore works but Storage doesn't, so they stub the bytes stages.
