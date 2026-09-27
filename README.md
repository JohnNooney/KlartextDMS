# KlartextDMS

A personal filing cabinet for German paperwork that explains each document in plain English.

Moving to Germany means a flood of contracts and official letters: Mietvertrag, Krankenversicherung, Internetvertrag, Behördenbriefe. Klartext stores them and, for each one, produces an **Extraction**: what kind of document it is, an English summary, the key takeaways (amounts, dates, obligations), and the critical warnings (notice periods, hidden fees, liabilities) that cost you money or rights if you miss them.

## Why two apps and an iframe

Klartext is also a sandbox for an enterprise integration problem: embedding a newly acquired Vue product inside a legacy Angular dashboard when the only integration point is an `<iframe>`. The constraint is deliberate, so the project is built as two independent frontends that talk **only** over `window.postMessage`. No Module Federation, no Web Components.

| | Host | Guest |
|---|---|---|
| Stack | Angular (latest stable), SCSS | Vue 3 (Composition API), Vite, TailwindCSS |
| Role | Sign-in, document list, uploads, the frame the Guest renders in | Document viewer + Extraction panel; calls the AI |
| Runs on | Its own port / Firebase Hosting site | Its own port / Firebase Hosting site |

**The Bus.** Every message is an Envelope `{ type, payload }`. The Host opens a Session (`INIT_SESSION`) when a Document is clicked; the Guest reports `AI_PROCESSING_STARTED` / `AI_PROCESSING_SUCCESS` / `AI_PROCESSING_ERROR`, and the Host locks the sidebar while processing runs.

**Platform.** Firebase end to end from the first cut: Hosting (two sites), Auth, Storage for Document bytes, Firestore for metadata and Extractions, and Firebase AI Logic (Gemini) called from the Guest with the PDF sent directly to the multimodal model. Local development runs against the Firebase emulators. One Extraction per Document is persisted and reused.

Vocabulary (Host, Guest, Document, Extraction, Bus, Envelope, Session) is defined in [`CONTEXT.md`](./CONTEXT.md); use those terms in code, issues, and docs.

## Status

Scaffolded: the pnpm workspace, both app shells, and the emulator harness exist. Feature work proceeds through the phased issues indexed in [`docs/spec.md`](./docs/spec.md); pick from open issues labelled `ready-for-agent` with no open blockers.

## Repository layout

```
apps/host           Angular dashboard — sign-in, library, PDF view, Guest iframe (:4200)
apps/guest          Vue 3 insights panel rendered in the Host's iframe (:5173)
packages/theme      shared Apple-style design tokens (CSS vars → SCSS / Tailwind)
packages/bus-contract  the { v, type, sessionId, payload } Envelope contract
packages/firebase-config  shared Firebase web config + emulator endpoints
scripts/            deterministic emulator seed (admin SDK) + fixture PDFs/Extractions
emulator-data/      committed emulator snapshot loaded via --import
CONTEXT.md          domain glossary
docs/adr/           architecture decision records
docs/deployment.md  hosting topology and per-Environment Peer Origins
```

## Local development

```sh
pnpm install
pnpm dev          # Host :4200 + Guest :5173 + Auth/Firestore/Storage emulators (seeded)
pnpm test         # unit/smoke suites across apps and packages
pnpm build        # build both apps
pnpm seed         # regenerate emulator-data/ from scripts/seed.mjs
pnpm emulators    # full emulator suite incl. Hosting emulator (:5000/:5005)
```

The emulator suite is seeded with the demo Auth user `test-user@test.com` / `test1234`, the prototype Folder tree, and three fixture Documents. The Guest loads inside the Host's iframe on :4200 — sign in with the seed credentials (the Email/Password form shows only under `useEmulators`).

**App Check debug token:** `pnpm dev` writes `apps/host/public/assets/config.local.json` (gitignored) from the root `.env`'s `KLARTEXT_HOST_DEBUG_TOKEN`, which the Host turns into `self.FIREBASE_APPCHECK_DEBUG_TOKEN` before `initializeAppCheck`. Preview builds get it from the same-named GitHub secret; production never carries it.

**Node/Angular note:** the workspace pins Node 20 LTS, so the Host uses Angular 21 — the newest major whose toolchain still supports Node 20 (Angular 22 requires ≥22.22).

**macOS port note:** the Hosting emulator's :5000 collides with the AirPlay Receiver. `pnpm dev` doesn't need it (dev uses ng/vite); for `pnpm emulators` or the e2e Hosting flow either disable AirPlay Receiver (System Settings → General → AirDrop & Handoff) or remap the port in `firebase.json`.

## Working on this repo

- Issues and specs: GitHub Issues via the `gh` CLI, see [`docs/agents/issue-tracker.md`](./docs/agents/issue-tracker.md).
- Agent conventions: [`AGENTS.md`](./AGENTS.md).

## License

[MIT](./LICENSE)
