---
status: accepted
---

# Action Item Done state lives on the DocumentRecord, keyed by content-hash ids

An Action Item's state is persisted as a map field on its Document, keyed by the existing content-hash `actionItemId` (`hash(sourceQuote, timing.kind)`, ADR 0010). Non-computable items keep `actionItemStates[actionItemId] = { doneAt }`. A computable monthly recurrence instead stores `{ trackingFrom, scheduleFingerprint, doneOccurrences: { [dueDate]: { doneAt } } }`. The Occurrence map is sparse: pending and Overdue cycles are derived at read time, and `doneThrough` is retired. One reversible **Done** state covers every timing kind — there is no separate "dismissed".

Only the Host writes state (ADR 0001). The Guest asks via `GUEST_SET_ACTION_ITEM_DONE { actionItemId, done, occurrenceDueDate? }` and learns the authoritative map from `Session.actionItemStates` and the Host→Guest `ACTION_ITEM_STATES` push. `occurrenceDueDate` is required for a monthly Occurrence and validated by the Host against the clamped schedule, tracking baseline, and projection horizon. Protocol `v` stays 1.

The shared pure Action Item projection (ADR 0012) is the single Host/Guest definition of per-Occurrence and aggregate Done/Urgency. Pending Mark done targets the oldest unfinished Occurrence; aggregate Undo targets the latest Done Occurrence. Optimistic Guest writes update one `doneOccurrences` entry and recompute the projection; the authoritative Host push confirms or rolls back. Arbitrary per-cycle actions belong to the occurrence UI, not the aggregate row. Full sparse Done history is retained until Document deletion or schedule reset.

For a new Document's initial Extraction, `trackingFrom` is the Document's `createdAt` local calendar date. For a pre-v2.1 Document, the Host lazily backfills monthly entries once its Extraction is available on the first v2.1 library load, using that backfill day as the cutover. A legacy `doneThrough` converts to one Done Occurrence only when it names an actual clamped Occurrence on or after the cutover; no earlier history is generated. This is a per-Document Host migration, not a server-wide batch or fixed release-date constant.

An unchanged schedule retains its state across re-analysis. A newly discovered monthly Action Item, changed cadence/`dayOfMonth`, or change into/out of computability resets the state and uses the original Document `createdAt` as `trackingFrom`, uncapped—even when earlier than the legacy cutover. The Document is the source of truth for Action Item dates, so historical Occurrences and Overdues produced by such a reset are intentional. The schedule fingerprint detects these changes without reopening ADR 0010's ids.

## Considered options

- **A field on `extractions/current`.** Rejected: re-analysis overwrites that document wholesale and would silently undo every mark.
- **A subcollection `documents/{id}/actionItemStates/{itemId}`.** Rejected: one more read per Document in the startup sweep plus a rules entry, while the DocumentRecord is already in `LibraryStore` memory and its update rule already covers the field. Occurrences are sparse map entries, not another subcollection.
- **Keep `doneThrough`.** Rejected: one contiguous watermark cannot represent a missed cycle between two Done cycles, late Done, or undo of one occurrence.
- **Persist every pending and Done Occurrence.** Rejected: pending cycles are deterministic from the schedule and baseline; storing them adds writes and unbounded records without adding information.
- **Start every item at its first Done or at re-analysis.** Rejected: the first would prevent Overdue before the first mark; the second would discard the Document's authority over its Action Item dates. Only the initial legacy backfill uses a cutover to avoid inventing history automatically.
- **Fuzzy re-matching after re-analysis.** Rejected: if a re-analysis shifts an item's quotation the id changes and the item resurfaces not-Done. Resurfacing something already handled is cheap; hiding something genuinely new is not.
- **Separate Completed and Dismissed states.** Rejected: they would store, render, and undo identically.
- **Recurring items remain never-Overdue.** Rejected by [Track individual occurrences of recurring Action Items](https://github.com/JohnNooney/KlartextDMS/issues/143): explicit tracking baselines now distinguish genuine tracked misses from pre-tracking history.

## Consequences

- Orphaned keys (ids no longer in the Extraction) are pruned when the Host saves a new Extraction. State is deleted with its Document; no rules or index changes.
- The existing Bus messages gain the optional targeted date and richer state shape; protocol `v` stays 1. Sanitizers and conformance fixtures must accept the new monthly entries without treating their mere existence as Done for non-computable items.
- The legacy backfill adds a one-time Host write per existing Document with monthly Action Items. Sparse Done history grows only when a cycle is marked; there is no rolling retention in v2.1.
- Occurrence presentation and arbitrary per-cycle actions are decided by [Recurring Action Item Occurrence UX prototype](https://github.com/JohnNooney/KlartextDMS/issues/183), separately from this state model.
