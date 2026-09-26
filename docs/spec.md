# Klartext — handoff spec

The wayfinder map ([Wayfinder map: Klartext handoff-ready spec](https://github.com/JohnNooney/KlartextDMS/issues/1)) is complete: every cross-cutting decision is resolved. This document is the build index — it does not restate decisions, it names them and links the ticket that holds each one. Domain vocabulary lives in `CONTEXT.md`.

## Architecture invariants

The decisions a builder must not re-litigate, each recorded as an ADR in `docs/adr/`:

- [Guest integrates only through a cross-origin iframe and the postMessage Bus](./adr/0006-iframe-only-guest-integration.md) — no Module Federation, no Web Components. (Research: [Cross-origin iframe on Firebase Hosting](https://github.com/JohnNooney/KlartextDMS/issues/4))
- [The Bus is the data plane](./adr/0001-bus-as-data-plane.md) — the Host owns all Firebase data access; the Guest only calls Gemini and returns results. ([Bus contract v1](https://github.com/JohnNooney/KlartextDMS/issues/7), amended by [UI prototype](https://github.com/JohnNooney/KlartextDMS/issues/12))
- [The Host renders the PDF; the Guest is an insights panel](./adr/0002-host-renders-the-pdf.md)
- [Extraction Jobs run in the background](./adr/0003-background-extraction-jobs.md) — enqueued on upload, one at a time, decoupled from which Document is open.
- [The Guest calls Gemini through the Firebase AI Logic client SDK; no backend proxy](./adr/0007-gemini-via-ai-logic-no-proxy.md) — App Check is the perimeter; quotas and billing alerts are the ceiling. (Research: [Firebase AI Logic and Gemini for PDF Extractions](https://github.com/JohnNooney/KlartextDMS/issues/3); abuse limits: [#21](https://github.com/JohnNooney/KlartextDMS/issues/21))
- [One Extraction per Document, persisted in Firestore and reused](./adr/0008-extraction-persisted-per-document.md) — schema per [Extraction schema and Gemini structured output](https://github.com/JohnNooney/KlartextDMS/issues/8); lifecycle per [#15](https://github.com/JohnNooney/KlartextDMS/issues/15).
- [Two Hosting sites with per-PR preview channels](./adr/0004-two-hosting-sites-preview-channels.md) — topology and Peer-Origin mechanics in `docs/deployment.md`. ([#11](https://github.com/JohnNooney/KlartextDMS/issues/11))
- [Folders form a client-side adjacency tree with recursive delete](./adr/0005-folder-tree-recursive-delete.md) — ([#20](https://github.com/JohnNooney/KlartextDMS/issues/20))

Cross-cutting decisions without ADRs: [workspace layout](https://github.com/JohnNooney/KlartextDMS/issues/2) (pnpm; `apps/host`, `apps/guest`, `packages/{theme,bus-contract,firebase-config}`; Node 20), [provisioned Firebase project](https://github.com/JohnNooney/KlartextDMS/issues/6) (`klartext-b836c`, europe-west10, Blaze), [auth flow](https://github.com/JohnNooney/KlartextDMS/issues/10) (Host Google sign-in + emulator Email/Password; Guest anonymous, identity as Session data), [document storage](https://github.com/JohnNooney/KlartextDMS/issues/9) (10 MB PDFs in Storage, metadata + `extractions/current` in Firestore, Host-only repositories), [PDF-only input](https://github.com/JohnNooney/KlartextDMS/issues/18), [testing pyramid](https://github.com/JohnNooney/KlartextDMS/issues/13) (Vitest + contract conformance + emulator integration + Playwright; CI gates `checks` / `rules+integration` / `e2e`).

## Build order

Issues are labelled `ready-for-agent`; dependencies are wired as native GitHub blocking edges, so the takeable set is whatever is open, unblocked, and unassigned. Each issue is sized for one agent session. Prototype branches (`prototype/ui-host-guest`, `prototype/pdf-viewer`) are behavioral reference only — no code ports.

| # | Issue | Blocked by | Decisions it implements |
|---|---|---|---|
| 1 | [Scaffold the pnpm workspace, both apps, and the emulator harness](https://github.com/JohnNooney/KlartextDMS/issues/22) | — | #2, #9, #11, #12 (theme), #20 (seeds), ADR 0004 |
| 2 | [Wire CI/CD: gates, per-PR preview channels (Guest-first), live deploy](https://github.com/JohnNooney/KlartextDMS/issues/23) | #22 | #11, #13, #21; contains a human console checklist |
| 3 | [Implement packages/bus-contract](https://github.com/JohnNooney/KlartextDMS/issues/24) | #22 | #7 (+ #12 amendment), #8, #13 |
| 4 | [Host shell: sign-in gate, app layout, Guest iframe mount, Bus adapter](https://github.com/JohnNooney/KlartextDMS/issues/25) | #22, #24 | #10, #4, #7 |
| 5 | [Guest shell: App Check, anonymous sign-in, handshake, panel skeleton](https://github.com/JohnNooney/KlartextDMS/issues/26) | #24 | #10, #21, #12 |
| 6 | [Document repositories and the upload pipeline](https://github.com/JohnNooney/KlartextDMS/issues/27) | #25 | #9, #16 (state machine), #18, rules from #10/#21 |
| 7 | [Document library UI](https://github.com/JohnNooney/KlartextDMS/issues/28) | #27 | #16, #12, #18 |
| 8 | [Open-Document view: pdf.js paged viewer and navigation](https://github.com/JohnNooney/KlartextDMS/issues/29) | #28 | #17, #12, ADR 0002 |
| 9 | [Guest Extraction client: Gemini via AI Logic](https://github.com/JohnNooney/KlartextDMS/issues/30) | #26 | #8, #3, #13 (fake provider), ADR 0007 |
| 10 | [Session flow and Extraction Job orchestration](https://github.com/JohnNooney/KlartextDMS/issues/31) | #25, #26, #27, #30 | #7 amendment, #15, ADR 0003/0008 |
| 11 | [Extraction lifecycle UX](https://github.com/JohnNooney/KlartextDMS/issues/32) | #28, #31 | #15, #16 |
| 12 | [Folders](https://github.com/JohnNooney/KlartextDMS/issues/33) | #28 | #20, ADR 0005, #12 |
| 13 | [Playwright e2e suite](https://github.com/JohnNooney/KlartextDMS/issues/34) | #23, #29, #31, #32, #33 | #13, #10 (email path), #11 (emulator ports) |

Issues 4/5 and 9 parallelize across the two apps; 8, 11, 12 parallelize once the library exists.

## Explicitly not in this build

- Library **search** over titles/descriptions/keywords: the fields are persisted per [#20](https://github.com/JohnNooney/KlartextDMS/issues/20) but no v1 consumer was decided — open fog on the map, to be revisited as a future effort.
- `GUEST_SHOW_PAGE` / evidence-to-page links — [Bus v2](https://github.com/JohnNooney/KlartextDMS/issues/19), deferred.
- Image/photo Documents ([#18](https://github.com/JohnNooney/KlartextDMS/issues/18)), multi-user sharing, native mobile, legal-accuracy guarantees — out of scope on the map.
