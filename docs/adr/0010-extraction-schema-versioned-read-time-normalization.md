---
status: accepted
---

# Extraction schema is versioned and stored v1 records are normalized at read time

Extraction v2 (`klartext-extraction-v2`) splits the single takeaway list into mutually exclusive `actionItems` and `keyTakeaways`, with structured `timing` on each Action Item. Stored `schemaVersion: 1` records are never migrated: `normalizeExtractionRecord` in `@klartext/bus-contract` adapts them on read (`CRITICAL` becomes an Action Item with `timing: NONE`, `NORMAL` becomes a Key Takeaway) and computes stable Action Item ids. New Extractions are always written as v2. The user upgrades a Document by re-analyzing it (ADR 0008).

## Considered options

- **Bulk migrate stored Extractions.** Rejected: dates cannot be derived from v1 data, so a migration would only relabel; re-running Gemini over every Document is silent spend, which ADR 0008 already rejects.
- **Dual-render v1 and v2 in every consumer.** Rejected: Folder rollups, search, and reminders would each need a v1 branch.

## Consequences

- Every Extraction reader (Host and Guest) must pass records through `normalizeExtractionRecord`; consumers only see v2 shapes.
- A normalized v1 record keeps `schemaVersion: 1` so the UI can offer re-analysis for dates.
- Action Item ids are a hash of `sourceQuote` and timing kind, so re-analysis that finds the same quote keeps the same id (reminder `UID`s and deep links stay stable).
