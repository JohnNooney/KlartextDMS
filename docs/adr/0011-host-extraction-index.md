---
status: accepted
---

# The Host holds one in-memory Extraction index for rollups and search

`LibraryStore.extractionsByDocId` is the single read model for everything that spans Documents: Folder attention overviews, library search, and reminder lookup. It is filled by the existing startup sweep (one `getDoc` per ready Document) and kept current by local write-through after every save and delete. Records are normalized once on insert (ADR 0010). `extractionsLoaded` marks when the sweep has finished so the UI shows partial state honestly. The design target is 500 Documents per library.

## Considered options

- **`collectionGroup` query over `extractions`.** Rejected: needs an `ownerId` backfill, a new rule, and an index, for the same N document reads.
- **Denormalized per-Folder or per-Document summary projection.** Rejected: schema coupling with the Extraction shape and a sync obligation on every save.
- **A search backend.** Rejected: far beyond the scale envelope.

## Consequences

- No `firestore.rules` or `firestore.indexes.json` change.
- `ExtractionFlow`'s private cache and `extractionStored` are removed in favour of the index.
- Cross-tab and cross-device staleness until reload is accepted: every write originates in this Host.
- Past ~2,000 Documents the sweep and memory cost must be revisited, likely via a denormalized summary.
