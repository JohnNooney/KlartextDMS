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
 e2e                Hosting emulator: Host :5000 (first site in
                    firebase.json), Guest :5005 (auto-assigned
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
      "target": "host",                       // site order matters: first = :5000
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
    "hosting": { "port": 5000 }
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
| dev | `http://localhost:5173` | true | committed `config.development.json` (copied at dev start) |
| e2e | `http://localhost:5005` | true | e2e variant written by the test run |
| preview | captured Guest channel URL | false | CI overwrites before Host deploy |
| production | `https://klartext-guest.web.app` | false | committed `config.production.json` |

The Bus's `targetOrigin` allow-list is populated from these values — still exactly one Peer Origin per app per Environment.

## App Check

Decided in [App Check enforcement and Gemini abuse limits](https://github.com/JohnNooney/KlartextDMS/issues/21).

Enforcement is `Enforced` on Firestore, Storage, and AI Logic — flipped on when the App Check SDK first lands in a deployable build, so previews and production run identical enforcement (AI Logic is auto-enforced on registration; there are no pre-App-Check clients to protect). Replay protection stays `Unenforced`; the reused-token metric in the console is the tripwire.

Both apps call `initializeAppCheck` in every Environment; only the provider varies:

| Environment | Provider | Token source |
|---|---|---|
| dev | debug | `KLARTEXT_HOST_DEBUG_TOKEN` / `KLARTEXT_GUEST_DEBUG_TOKEN` from the local `.env` |
| e2e | debug | build-time env var; GitHub secret in CI |
| preview | debug | same GitHub secret, injected at the preview build |
| production | reCAPTCHA Enterprise | site key pinned to the exact prod hostnames — no `web.app` apex, so hashed preview channels can't attest and deliberately run the debug provider |

The debug token is the only secret-ish value in the client config tree: never committed, never baked into production builds.

The v1 Gemini abuse ceiling is enforced App Check plus, all without backend code: the AI Logic per-user quota lowered to ~10 Generate Content requests/min (default 100), a project-level cap of ~500 requests/day set as a quota override in the Cloud console, and billing alerts at €5/€25. A hard auto-shutdown would need a budget-automation Cloud Function — excluded by the no-backend constraint.

## CI

Two workflows, replacing the auto-generated single-site skeletons:

- **On PR** (`firebase-hosting-pull-request.yml`): pnpm install → lint → unit tests → build both apps → Playwright e2e against the emulator suite (`firebase emulators:exec`, using `FIREBASE_SERVICE_ACCOUNT_KLARTEXT_B836C`) → preview deploy: **Guest channel first** (`channelId: pr-<n>`), capture its URL, write it into the Host's `config.json`, then deploy the **Host channel**. The GitHub action posts both preview URLs on the PR.
- **On merge to main** (`firebase-hosting-merge.yml`): same checks, then `firebase deploy` — both sites' live channels plus `firestore.rules`/`storage.rules`.
