# Deployment topology and environments

Decided in [Deployment topology and environments](https://github.com/JohnNooney/KlartextDMS/issues/11). The `why` lives in [ADR 0004](adr/0004-two-hosting-sites-preview-channels.md); this file is the `what`.

## Topology

One Firebase project (`klartext-b836c`), two Hosting sites:

| Site | App | Production origin |
|---|---|---|
| `klartext-host` | Host (Angular, `apps/host`) | `https://klartext-host.web.app` (+ `.firebaseapp.com`) |
| `klartext-guest` | Guest (Vue, `apps/guest`) | `https://klartext-guest.web.app` (+ `.firebaseapp.com`) |

The Guest renders in the Host's `<iframe>`, so the two are genuinely cross-origin in production — the point of the exercise. No custom domains.

```
                    ┌─────────────────────────────────────────┐
 dev                │  ng serve :4200  ═╦═  vite :5173        │
                    │       Host        ║       Guest         │
                    │                   ║  (iframe, x-origin  │
                    │                   ║   by port)          │
                    └───────────────────╨─────────────────────┘
 e2e                Hosting emulator: Host :5050 (first site in
                    firebase.json), Guest :5055 (auto-assigned
                    convention — see ADR 0004 escape hatch)
 preview            klartext-host--pr-N-<hash>.web.app
                    klartext-guest--pr-N-<hash>.web.app
 production         klartext-host.web.app ═ iframe ═ klartext-guest.web.app
```

All environments share the project's Auth / Firestore / Storage / AI Logic — emulated in dev and e2e, real in preview and production.

## `firebase.json` outline

```jsonc
{
  "firestore": { "rules": "firestore.rules", "indexes": "firestore.indexes.json" },
  "storage": { "rules": "storage.rules" },
  "hosting": [
    {
      "target": "host",                       // site order matters: first = :5050
      "public": "apps/host/dist/<browser>",   // Angular output dir
      "rewrites": [{ "source": "**", "destination": "/index.html" }],
      "headers": [{
        "source": "**",
        "headers": [{
          "key": "Content-Security-Policy",
          "value": "frame-ancestors 'none'"   // nothing ever embeds the Host
        }]
      }]
    },
    {
      "target": "guest",
      "public": "apps/guest/dist",
      "rewrites": [{ "source": "**", "destination": "/index.html" }],
      "headers": [{
        "source": "**",
        "headers": [{
          "key": "Content-Security-Policy",
          // prod Host origins + preview channels + localhost dev/e2e
          "value": "frame-ancestors 'self' https://klartext-host.web.app https://klartext-host.firebaseapp.com https://*.web.app http://localhost:*"
        }]
      }]
    }
  ],
  "emulators": {
    "hosting": { "port": 5050 }
    // auth/firestore/storage ports per emulator defaults
  }
}
```

`.firebaserc` gains deploy targets (created by `firebase target:apply hosting host klartext-host` and `… guest klartext-guest`):

```jsonc
{
  "projects": { "default": "klartext-b836c" },
  "targets": {
    "klartext-b836c": {
      "hosting": { "host": ["klartext-host"], "guest": ["klartext-guest"] }
    }
  }
}
```

## Peer origins

Each app learns the other's origin differently:

- **Guest → Host**: `document.referrer` of the Guest's iframe document — the embedding Host's origin, at runtime, in every environment including hashed preview URLs. No config.
- **Host → Guest** (needed to set the iframe `src`): a static `assets/config.json` fetched before bootstrap, carrying `guestOrigin` and `useEmulators`. One mechanism for all environments; the file's contents vary, not the code.

| Environment | `guestOrigin` | `useEmulators` | Source of `config.json` |
|---|---|---|---|
| dev | `http://localhost:5173` | true | committed `config.json`, overlaid by gitignored `config.local.json` (App Check debug token from `.env`, written by `pnpm start`'s `prestart` hook) |
| e2e | `http://localhost:5055` | true | e2e variant written by the test run |
| preview | captured Guest channel URL | false | CI overwrites before Host deploy (including `appCheckDebugToken` from the GitHub secret) |
| production | `https://klartext-guest.web.app` | false | committed `config.production.json` (`appCheckSiteKey` + `allowedEmails` — the sign-in allowlist, mirrored by the rules `isAllowedUser()`) |

The Bus's `targetOrigin` allow-list is populated from these values — still exactly one Peer Origin per app per Environment.

## App Check

Decided in [App Check enforcement and Gemini abuse limits](https://github.com/JohnNooney/KlartextDMS/issues/21).

Enforcement is `Enforced` on Firestore, Storage, and AI Logic — flipped on when the App Check SDK first lands in a deployable build, so previews and production run identical enforcement (AI Logic is auto-enforced on registration; there are no pre-App-Check clients to protect). Replay protection is `Enforced` on the AI Logic service (`firebaseml`), so the Guest requests a **limited-use** App Check token per call (`useLimitedUseAppCheckTokens: true` in `getAI`) — a regular exchanged token is rejected by `firebasevertexai` with 401 "token is invalid". Debug tokens still work: the SDK adds `limited_use` to the debug exchange.

Both apps call `initializeAppCheck` in every Environment; only the provider varies:

| Environment | Provider | Token source |
|---|---|---|
| dev | debug | `KLARTEXT_HOST_DEBUG_TOKEN` / `KLARTEXT_GUEST_DEBUG_TOKEN` from the local `.env` |
| e2e | debug | build-time env var; GitHub secret in CI |
| preview | debug | same GitHub secret, injected at the preview build |
| production | reCAPTCHA Enterprise | site key pinned to the exact prod hostnames — no `web.app` apex, so hashed preview channels can't attest and deliberately run the debug provider |

The debug token is the only secret-ish value in the client config tree: never committed, never baked into production builds.

The v1 Gemini abuse ceiling is enforced App Check plus, all without backend code: the AI Logic per-user quota lowered to ~10 Generate Content requests/min (default 100), a project-level cap of ~500 requests/day set as a quota override in the Cloud console, and billing alerts at €5/€25. A hard auto-shutdown would need a budget-automation Cloud Function — excluded by the no-backend constraint.

The Guest uses the **Gemini Developer API** backend (`GoogleAIBackend`, revised ADR 0007) for its free tier — calls still pass through `firebasevertexai.googleapis.com` plus the matching platform API, which the console's "Get started" may not enable; calls then fail 403 `SERVICE_DISABLED`. Developer API backend needs `generativelanguage.googleapis.com`:

```bash
gcloud services enable generativelanguage.googleapis.com --project=klartext-b836c
```

(The Vertex/Agent Platform backend would instead need `aiplatform.googleapis.com`; not used.)

The opt-in live check `VERIFY_GEMINI=1 pnpm --filter @klartext/guest exec vitest run src/extraction/gemini-live.spec.ts` exercises the real round-trip (debug-token exchange → anonymous sign-in → `generateContent`) against a seeded fixture PDF; skipped by default since each run costs ~$0.004.

## Storage bucket CORS

`getBytes`/`uploadBytesResumable` are browser calls to `firebasestorage.googleapis.com`, so the real bucket needs a CORS policy for every origin that loads or uploads a PDF — preview channels and production; the emulator ignores CORS, which is why nothing surfaces in dev or e2e. Preview hostnames are hashed per PR, so `storage.cors.json` uses `origin: ["*"]` (CORS is not the access boundary — Storage rules and App Check are). The `X-Goog-Upload-*` response headers must be exposed or resumable uploads break.

One-time per bucket (no Firebase CLI equivalent):

```bash
gcloud storage buckets update gs://klartext-b836c.firebasestorage.app \
  --cors-file=storage.cors.json
```

## CI

The three gate jobs live in the reusable `.github/workflows/ci.yml` (`workflow_call`), called by both entry workflows so the same checks gate previews and live deploys:

- `checks`: pnpm install → `pnpm -r --if-present lint` (no lint tooling yet — `typecheck` is the static gate) → unit tests.
- `rules+integration`: `pnpm test:integration` — `firebase emulators:exec` over the seed plus each package's `test:integration`, where emulator-backed repository tests and the `@firebase/rules-unit-testing` suite accumulate.
- `e2e`: `pnpm e2e` — `pnpm build:e2e` (the e2e Environment builds), then `firebase emulators:exec --only auth,firestore,storage,hosting` over the seed plus `pnpm test:e2e` (Playwright, chromium, Guest via `frameLocator`).

- **On PR** (`firebase-hosting-pull-request.yml`): gates → preview deploy — **Guest channel first** (`channelId: pr-<n>`), capture its URL, write it into the Host's `config.json`, build and deploy the **Host channel**. The deploy action posts each preview URL on the PR.
- **On merge to main** (`firebase-hosting-merge.yml`): gates → production `config.json` → `firebase deploy` — both sites' live channels plus `firestore.rules`/`storage.rules`.
