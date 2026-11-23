---
status: accepted
---

# Batch re-analysis is user-initiated and never automatic

ADR 0010 rejected bulk-migrating stored Extractions because re-running Gemini over every Document is silent spend. We still let the user re-analyze many Documents at once — chiefly to bring Outdated Extractions (`schemaVersion < CURRENT_EXTRACTION_SCHEMA_VERSION` in `bus-contract`) onto the current schema — but only as an explicit Batch re-analysis. The user either picks a criterion (Outdated format, Couldn't analyze, or All documents) over the current Folder and its nested Folders, or hand-picks ready Documents through a Library selection limited to the current grid. In both cases the user sees the eligible count and confirms; a mixed hand-picked selection discloses any Documents excluded by the shared eligibility rules. The Host never starts one on its own, and ADR 0010 stays accepted: Outdated Extractions are still normalized at read time until the user acts.

Batch members are ordinary Extraction Jobs (ADR 0003) on the same serial queue, behind upload, retry, and Translation work. Nothing about a batch is persisted: a reload ends it. Criteria describe per-Document state, so re-running one picks up whatever is still left; a hand-picked Library selection is transient and must be chosen again.

## Considered options

- **Auto-migrate on schema bump** (re-queue every Outdated Extraction on load). Rejected: the silent spend ADR 0010 rules out.
- **Persist the batch** (a Firestore batch record resumed on load). Rejected: needs a new collection, rules, and resume semantics for transient user intent; criteria already recompute their remainder, and a hand-picked Library selection is deliberately ephemeral.
- **Hand-picked Library selection in the grid.** Accepted in [Hand-pick Documents for re-analysis with multi-select in the library grid](https://github.com/JohnNooney/KlartextDMS/issues/160) as a second membership source, limited to visible ready Documents in the current grid. Criteria remain the recursive Folder-scope path; the selection never includes Folders or hidden nested Documents.

## Consequences

- Upgrading a v1 Extraction can change Action Item ids (`timing: NONE` becomes a real timing kind), so Done marks and exported Reminder `UID`s may reset (ADR 0013 kept); the confirm dialog warns when the selection has Done marks. Carrying marks across a schema upgrade is [#161](https://github.com/JohnNooney/KlartextDMS/issues/161).
- The Extraction Job queue gains a priority split; Translations (ADR 0009) share it.
- `BatchReanalysis` retains `start(scope, criterion)` and adds `startSelected(documentIds)`. Both filter through the same eligibility rules and share one queueing implementation and batch lifecycle; callers do not reimplement eligibility.
- Hand-picked Re-analyze omits the criteria picker but retains explicit confirmation, the eligible title list and count, excluded-member disclosure, Done/Reminder warnings, and the large-batch quota warning.
- There is no hard cap; explicit confirmation plus the quotas and billing alerts of ADR 0007 are the ceiling. A batch stops after three consecutive failures rather than recording a failure on every remaining Document.
