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

Planning. No application code yet.

Design decisions are being worked through a [wayfinder map](https://github.com/JohnNooney/KlartextDMS/issues/1) on this repo's issues: each child ticket resolves one decision, and the map ends in a handoff-ready spec plus phased implementation issues. Resolved research lives under `docs/research/` on `research/*` branches until merged.

## Repository layout

```
CONTEXT.md          domain glossary
docs/agents/        how agents use this repo's issue tracker, labels, and domain docs
docs/adr/           architecture decision records (created as decisions land)
docs/research/      research findings feeding the map's decisions
```

The planned workspace (pnpm/npm) adds `apps/host`, `apps/guest`, and shared `packages/` (theme tokens, Bus contract types) once the layout ticket is resolved.

## Working on this repo

- Issues and specs: GitHub Issues via the `gh` CLI, see [`docs/agents/issue-tracker.md`](./docs/agents/issue-tracker.md).
- Agent conventions: [`AGENTS.md`](./AGENTS.md).

## License

[MIT](./LICENSE)
