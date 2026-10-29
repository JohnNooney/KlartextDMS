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

- Library **search**: not in v1; designed in v2 (below).
- `GUEST_SHOW_PAGE` / evidence-to-page links — shipped inside the v1 Envelope ([issue #78](https://github.com/JohnNooney/KlartextDMS/issues/78)); the quoted passage highlights in the Host's text layer ([issue #80](https://github.com/JohnNooney/KlartextDMS/issues/80)).
- Image/photo Documents ([#18](https://github.com/JohnNooney/KlartextDMS/issues/18)), multi-user sharing, native mobile, legal-accuracy guarantees — out of scope on the map.

---

# v2

Wayfinder map: [Klartext v2 backlog](https://github.com/JohnNooney/KlartextDMS/issues/98). Five tracks; decisions are recorded here as each ticket resolves, including follow-ons surfaced during implementation (urgency consistency, Action Item completion, overlay surfaces, batch re-analysis). Vocabulary additions in `CONTEXT.md`: **Action Item** (replaces Critical Warning), **Reminder**, **Translation**, **Urgency**, **Done**, **Outdated Extraction**, **Batch re-analysis**.

## v2 architecture deltas

- [Extraction schema is versioned; v1 records are normalized at read time](./adr/0010-extraction-schema-versioned-read-time-normalization.md) — `klartext-extraction-v2`, Action Items vs Key Takeaways, structured `timing`. ([#99](https://github.com/JohnNooney/KlartextDMS/issues/99))
- [The Host holds one in-memory Extraction index](./adr/0011-host-extraction-index.md) — `LibraryStore.extractionsByDocId`. ([#101](https://github.com/JohnNooney/KlartextDMS/issues/101))
- [Translations run as on-demand Bus jobs and persist page by page](./adr/0009-translation-persisted-per-page.md) — ([#105](https://github.com/JohnNooney/KlartextDMS/issues/105), research [#100](https://github.com/JohnNooney/KlartextDMS/issues/100))
- [Action Item Urgency rules live in the shared Bus contract](./adr/0012-shared-action-item-urgency-rules.md) — one bucketing + labelling function in `bus-contract`; colour means Urgency, never category, in both apps. ([#132](https://github.com/JohnNooney/KlartextDMS/issues/132))
- [Action Item Done state lives on the DocumentRecord, keyed by content-hash ids](./adr/0013-action-item-done-state-on-document-record.md) — one reversible **Done** state for every timing kind; monthly recurrences are Done per occurrence (`doneThrough`); shared `isDone` in `bus-contract`; Guest marks via `GUEST_SET_ACTION_ITEM_DONE`, Host pushes `ACTION_ITEM_STATES`. Host overview hides Done (Undo toast; "Done (n)" group in See All); Guest moves Done items to a collapsed group. ([#134](https://github.com/JohnNooney/KlartextDMS/issues/134))
- [Overlay surface policy: one style per kind of surface, all modals Host-owned](./adr/0014-overlay-surface-policy.md) — on phones the Reminder is full-screen, other dialogs stay centred, the attention "See All" sheet is a modal medium/large sheet with a close (X) button (never "Done"), and menus stay anchored popovers that open upwards near the bottom edge. Every modal traps and restores focus, and unsaved input asks "Discard changes?". The Guest's ⋯ menu is its only overlay (ADR 0006). ([#141](https://github.com/JohnNooney/KlartextDMS/issues/141))
- [Batch re-analysis is user-initiated and never automatic](./adr/0015-batch-reanalysis-user-initiated.md) — refines ADR 0010's rejection of *silent* bulk migration. Criteria Outdated format (`schemaVersion < CURRENT_EXTRACTION_SCHEMA_VERSION`; `promptVersion` ignored) / Couldn't analyze / All documents over the current Folder and nested Folders (whole library at root); never-analyzed and in-flight Documents excluded. Entry from a library-toolbar ⋯ item plus a nudge when the scope has Outdated Extractions (no Folder-tile entry); centred confirm dialog with live counts, a collapsed title list, a Done/Reminder warning only when relevant, a quota line above 50, no hard cap. Batch members ride the serial queue behind upload/retry/Translation work, one batch at a time, nothing persisted (a reload ends it; re-running picks up the rest). Progress strip "Re-analyzing 3 of 14 · Cancel" in library and reader; Cancel drops unstarted members. No per-Document toasts — one summary with "Try again" for failures; stop after 3 consecutive failures. Done marks and Reminder `UID`s may reset on upgrade (ADR 0013 kept). ([#156](https://github.com/JohnNooney/KlartextDMS/issues/156))

Feature decisions without ADRs: [Folder attention overview](https://github.com/JohnNooney/KlartextDMS/issues/102) (prototype `prototype/folder-attention-overview`, behavioral reference only — no code ports), [library search](https://github.com/JohnNooney/KlartextDMS/issues/103), [calendar reminders](https://github.com/JohnNooney/KlartextDMS/issues/104).

## v2 build order

Same rules as v1. Each slice carries its own unit, contract, integration and Playwright coverage; there is no trailing e2e ticket. Phase A (extraction and Host features) and Phase B (translation) are independent and can run in parallel; Phase C (overlay surfaces) runs alongside them, with only C5 and C6 waiting on A8. Phase D (batch re-analysis) starts now with D0 and D1 in parallel; D2 waits on both plus A8, C2 and C3.

| # | Issue | Blocked by | Decisions it implements |
|---|---|---|---|
| A1 | [Extraction v2 core: bus-contract schema, normalizer, Guest prompt, fixtures](https://github.com/JohnNooney/KlartextDMS/issues/117) | — | #99, ADR 0010 |
| A2 | [Guest panel: Action Items vs Key Takeaways, timing chips, v1 note](https://github.com/JohnNooney/KlartextDMS/issues/118) | #117 | #99 |
| A3 | [Host Extraction index: LibraryStore.extractionsByDocId](https://github.com/JohnNooney/KlartextDMS/issues/119) | #117 | #101, ADR 0011 |
| A4 | [Host Folder attention overview](https://github.com/JohnNooney/KlartextDMS/issues/120) | #117, #119 | #102 |
| A5 | [Library search across Documents, Folders, and Extractions](https://github.com/JohnNooney/KlartextDMS/issues/121) | #119 | #103 |
| A6 | [Calendar reminders from Action Items](https://github.com/JohnNooney/KlartextDMS/issues/122) | #117, #118, #119, #120 | #104 |
| A7 | [Shared Action Item urgency in Host and Guest](https://github.com/JohnNooney/KlartextDMS/issues/133) | #120 (+ #132 decision) | #132, ADR 0012 |
| A8 | [Action Item Done state in Host and Guest](https://github.com/JohnNooney/KlartextDMS/issues/144) | #133 | #134, ADR 0013 |
| B1 | [Translation Bus contract and Guest translation client](https://github.com/JohnNooney/KlartextDMS/issues/123) | — | #105, ADR 0009 |
| B2 | [Host Translation orchestration, persistence, and rules](https://github.com/JohnNooney/KlartextDMS/issues/124) | #123 | #105, ADR 0009 |
| B3 | [Reader Translated view](https://github.com/JohnNooney/KlartextDMS/issues/125) | #124 | #105 |
| C1 | [Guest ⋯ menu closes on outside click and Escape](https://github.com/JohnNooney/KlartextDMS/issues/148) | — | #141, ADR 0014 |
| C2 | [Shared Host menu styles, z-index scale, and overlay tokens](https://github.com/JohnNooney/KlartextDMS/issues/149) | — | #141, ADR 0014 |
| C3 | [Host modal surfaces trap focus and share dismissal and viewport tracking](https://github.com/JohnNooney/KlartextDMS/issues/150) | — | #141, ADR 0014 |
| C4 | [Confirm before discarding unsaved dialog input](https://github.com/JohnNooney/KlartextDMS/issues/151) | #150 | #141, ADR 0014 |
| C5 | [Extract the Host sheet primitive from the Guest frame](https://github.com/JohnNooney/KlartextDMS/issues/152) | #144 | #141, ADR 0014 |
| C6 | [Attention See All sheet on the shared sheet primitive](https://github.com/JohnNooney/KlartextDMS/issues/153) | #144, #149, #150, #152 | #141, ADR 0014 |

Phase C implements [#141](https://github.com/JohnNooney/KlartextDMS/issues/141). C1–C3 can start now. C5 and C6 wait for A8 because they rework the same attention sheet.

| # | Issue | Blocked by | Decisions it implements |
|---|---|---|---|
| D0 | [Batch re-analysis UX prototype](https://github.com/JohnNooney/KlartextDMS/issues/157) | — | #156 |
| D1 | [Batch re-analysis engine: outdated detection, queue priority, BatchReanalysis service](https://github.com/JohnNooney/KlartextDMS/issues/158) | — | #156, ADR 0015 |
| D2 | [Batch re-analysis UI: toolbar entry, nudge, dialog, progress strip](https://github.com/JohnNooney/KlartextDMS/issues/159) | #157, #158, #144, #149, #150 | #156, ADR 0015, ADR 0014 |

Phase D implements [#156](https://github.com/JohnNooney/KlartextDMS/issues/156). D0 is a `wayfinder:prototype` on `prototype/batch-reanalysis` (behavioral reference only — no code ports) that settles nudge and progress-strip placement, dialog layout, and toast copy. D1 and B2 ([#124](https://github.com/JohnNooney/KlartextDMS/issues/124)) both need priority in the shared serial queue; whichever lands second adopts the other's mechanism.

## Explicitly not in v2

- Direct Google Calendar API event creation via OAuth ([#104](https://github.com/JohnNooney/KlartextDMS/issues/104)).
- Split original/translated view, search over Translations, Translations as Extraction input ([#105](https://github.com/JohnNooney/KlartextDMS/issues/105)).
- Search backend, fuzzy matching, EN↔DE query translation ([#103](https://github.com/JohnNooney/KlartextDMS/issues/103)); libraries beyond ~2,000 Documents ([#101](https://github.com/JohnNooney/KlartextDMS/issues/101)).
- Per-occurrence tracking of recurring Action Items, and missed cycles reading Overdue ([#143](https://github.com/JohnNooney/KlartextDMS/issues/143), deferred from [#134](https://github.com/JohnNooney/KlartextDMS/issues/134)).
- Bottom action sheets for menus, sheets for every dialog on phones, and a Done/Cancel sheet header ([#141](https://github.com/JohnNooney/KlartextDMS/issues/141), ADR 0014).
- Automatic re-analysis on a schema bump, persisted batches, and hand-picked multi-select in the library grid ([#160](https://github.com/JohnNooney/KlartextDMS/issues/160), ADR 0015).
- Carrying Done marks across an Extraction schema upgrade ([#161](https://github.com/JohnNooney/KlartextDMS/issues/161), ADR 0013 kept).
