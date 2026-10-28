---
status: accepted
---

# Action Item Done state lives on the DocumentRecord, keyed by content-hash ids

An Action Item's **Done** mark is persisted as a map field on its Document, `users/{uid}/documents/{documentId}.actionItemStates: { [actionItemId]: { doneAt, doneThrough? } }`, keyed by the existing content-hash `actionItemId` (`hash(sourceQuote, timing.kind)`, ADR 0010). One state covers every timing kind — there is no separate "dismissed". Only the Host writes it (ADR 0001); the Guest asks via `GUEST_SET_ACTION_ITEM_DONE { actionItemId, done }` and learns the authoritative map from `Session.actionItemStates` and the Host→Guest `ACTION_ITEM_STATES` push.

A pure `isDone(item, state, today)` in `packages/bus-contract`, beside `actionUrgency` (ADR 0012), is the single definition of whether an item is Done today. For a computable recurrence (`MONTHLY` + `dayOfMonth`), marking Done records `doneThrough` = the `dueDate` of the occurrence shown, and the item stays Done only while `nextOccurrence(today) ≤ doneThrough` — it returns by itself when the next cycle comes up. Every other item is Done until undone. `actionUrgency` stays unaware of Done, and recurring items remain never-Overdue.

## Considered options

- **A field on `extractions/current`.** Rejected: re-analysis overwrites that document wholesale and would silently undo every mark.
- **A subcollection `documents/{id}/actionItemStates/{itemId}`.** Rejected: one more read per Document in the startup sweep plus a rules entry, while the DocumentRecord is already in `LibraryStore` memory and its update rule already covers the field.
- **Fuzzy re-matching after re-analysis.** Rejected: if a re-analysis shifts an item's quotation the id changes and the item resurfaces not-Done. Resurfacing something already handled is cheap; hiding something genuinely new is not.
- **Separate Completed and Dismissed states.** Rejected: they would store, render, and undo identically.
- **Missed recurring occurrences read Overdue.** Deferred to [#143](https://github.com/JohnNooney/KlartextDMS/issues/143): without history before tracking started, every rent Document opened after its due day would light up red even when paid.

## Consequences

- Orphaned keys (ids no longer in the Extraction) are pruned when the Host saves a new Extraction.
- Done state is deleted with its Document; no rules or index changes.
- The Bus gains one message each way; protocol `v` stays 1.
