---
status: accepted
---

# Batch re-analysis is user-initiated and never automatic

ADR 0010 rejected bulk-migrating stored Extractions because re-running Gemini over every Document is silent spend. We still let the user re-analyze many Documents at once — chiefly to bring Outdated Extractions (`schemaVersion < CURRENT_EXTRACTION_SCHEMA_VERSION` in `bus-contract`) onto the current schema — but only as an explicit Batch re-analysis: the user picks a criterion (Outdated format, Couldn't analyze, or All documents) over the current Folder and its nested Folders, sees the count, and confirms. The Host never starts one on its own, and ADR 0010 stays accepted: Outdated Extractions are still normalized at read time until the user acts.

Batch members are ordinary Extraction Jobs (ADR 0003) on the same serial queue, behind upload, retry, and Translation work. Nothing about a batch is persisted: a reload ends it, and because the criteria describe per-Document state, re-running the batch picks up whatever is still left.

## Considered options

- **Auto-migrate on schema bump** (re-queue every Outdated Extraction on load). Rejected: the silent spend ADR 0010 rules out.
- **Persist the batch** (a Firestore batch record resumed on load). Rejected: needs a new collection and rules for state the criteria already recompute.
- **Hand-picked multi-select in the grid.** Deferred to [#160](https://github.com/JohnNooney/KlartextDMS/issues/160): the grid has no selection model, and criteria reach nested Folders that aren't on screen.

## Consequences

- Upgrading a v1 Extraction can change Action Item ids (`timing: NONE` becomes a real timing kind), so Done marks and exported Reminder `UID`s may reset (ADR 0013 kept); the confirm dialog warns when the selection has Done marks. Carrying marks across a schema upgrade is [#161](https://github.com/JohnNooney/KlartextDMS/issues/161).
- The Extraction Job queue gains a priority split; Translations (ADR 0009) share it.
- There is no hard cap; explicit confirmation plus the quotas and billing alerts of ADR 0007 are the ceiling. A batch stops after three consecutive failures rather than recording a failure on every remaining Document.
