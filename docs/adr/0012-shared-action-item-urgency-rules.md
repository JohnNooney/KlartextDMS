---
status: accepted
---

# Action Item Urgency rules live in the shared Bus contract

One shared pure Action Item projection in `packages/bus-contract` is the single definition of **Urgency**: it buckets an Action Item into *Overdue* / *This week* / *Later* / *No date* and produces the timing label both apps show. Existing `actionUrgency` / `isDone` behavior for non-recurring and uncomputable timing remains unchanged behind wrappers or migrated call sites; computable monthly recurrences require the Action Item's persisted state as well as `timing` and `today`.

`FIXED_DATE` buckets by whole days to the due date (past → Overdue, within 7 → This week, else Later). `RECURRING` computes Occurrences only for `MONTHLY` with `dayOfMonth`; other cadences carry too little to compute honestly and stay Later. Every month has an Occurrence: its due day is `min(dayOfMonth, daysInMonth)`, including leap-year February. This replaces the original skip-short-months rule.

For a computable monthly recurrence, the projection derives every Occurrence from `trackingFrom` through the next Occurrence on/after today, inclusive, and no later cycles. The oldest unfinished Occurrence drives aggregate Urgency and `dueDate`: past → Overdue, today through 7 days → This week, else Later. A newer Done Occurrence never hides an older miss. The whole Action Item is Done only when every tracked Occurrence through the current one is Done, preserving early Done and automatic return when the next cycle enters the projection. `NOTICE_PERIOD` stays Later because its anchor is an event, not a date; `NONE` is No date. Labels are relative inside the week window ("Due in 3 days") and absolute beyond ("Due 31 Jul 2024").

Colour carries Urgency at item level in both apps — red for Overdue, orange for This week, neutral otherwise — using the AA text shades `--kt-danger-text` (`#d70015`) and `--kt-warning-text` (`#b35c00`) in `packages/theme/tokens.css`, with the bright tokens kept for shapes. Orange is never a category colour: the Guest's "Needs your attention" section identity is structural (its title — no caution glyph, #133), so its list borders and number circles stay neutral like Key Takeaways, and per-item Urgency shows only on the timing chip.

## Considered options

- **Each app classifies locally.** Rejected: the Host had already drifted (relative labels, urgency tints) from the Guest (absolute, neutral); duplication guarantees more of it.
- **A new shared package.** Rejected: two consumers and one pure projection don't justify a package; `ActionTiming` and Action Item state already live in `bus-contract`.
- **Urgency persisted on the Extraction.** Rejected: it decays every midnight — it's a read-time projection of `timing`, Action Item state, and today.
- **Recurring items remain never-Overdue and short months are skipped.** Rejected by [Track individual occurrences of recurring Action Items](https://github.com/JohnNooney/KlartextDMS/issues/143): tracking baselines prevent false history without hiding genuine misses, and clamping gives every monthly cycle an actual due date.
- **Compute every recurrence cadence.** Rejected for v2.1: `WEEKLY`, `QUARTERLY`, and `YEARLY` lack enough structured timing. They keep their existing Later / Done-until-undone behavior.
- **Orange keeps meaning "Action Item".** Rejected: then the Guest's undated items look identical to due-soon ones, and the Host's This-week needs a third colour — the exact confusion the ticket existed to fix.

## Consequences

- `bus-contract` gains presentation-adjacent domain logic beyond wire types — accepted deliberately so the same item reads identically in both apps. The shared projection, not independent consumer-side combinations of `actionUrgency` and `isDone`, owns monthly aggregate behavior.
- The Guest's timing chip gains a clock (`today`) and urgency tint; Host's `classify`/`dueLabel` are replaced by the shared projection.
- Per-occurrence state, migration, and targeted writes are decided by [ADR 0013](./0013-action-item-done-state-on-document-record.md). Their rendering and arbitrary per-cycle actions are settled separately by [Recurring Action Item Occurrence UX prototype](https://github.com/JohnNooney/KlartextDMS/issues/183). User-set `NOTICE_PERIOD` anchor dates remain out of scope.
