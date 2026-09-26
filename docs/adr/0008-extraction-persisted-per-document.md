---
status: accepted
---

# One Extraction per Document, persisted in Firestore and reused

An Extraction is computed once per Document — by an Extraction Job that the Host enqueues when the upload reaches `ready` — and stored at `users/{uid}/documents/{documentId}/extractions/current`. The fixed `current` identity enforces one Extraction while keeping list reads small. Opening a Document always reuses the stored Extraction; producing one is never part of opening. Re-analysis happens only on explicit request (the Guest's ⋯ menu → `RETRY_EXTRACTION`) and replaces the stored Extraction atomically on success; a failed re-run leaves the previous Extraction untouched under a warning banner. Extraction Jobs are therefore idempotent background work keyed by `jobId`, not by which Document is open (ADR 0003).

## Considered options

- **Extract on open, cache opportunistically.** Rejected: the user pays latency and the project pays money on every view; the upload-time job makes the panel instant and the cost predictable.
- **Extraction history (versioned subcollection).** Rejected for v1: no consumer, and `schemaVersion`/`promptVersion`/`createdAt` on the record leave room to add history without changing today's interface.
- **Staleness invalidation (re-extract when the prompt bumps).** Rejected: silent spend; a future prompt bump can ship an explicit re-analyze affordance instead.

## Consequences

- The Document's lifecycle gains a job axis (`extractionState`: `none`/`queued`/`running`/`failed`) orthogonal to the stored Extraction — a failed re-run can coexist with a good Extraction.
- `RETRY_EXTRACTION { documentId }` is the single "enqueue a job" message serving both retry and re-analyze, because the Guest holds no bytes.
- On Host load, every ready Document with no Extraction and no recorded failure is re-queued: an interrupted job is recovered, never persisted as `running`.
