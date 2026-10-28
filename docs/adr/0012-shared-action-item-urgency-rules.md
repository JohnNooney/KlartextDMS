---
status: accepted
---

# Action Item Urgency rules live in the shared Bus contract

One function in `packages/bus-contract` — `actionUrgency(timing, today)` — is the single definition of **Urgency**: it buckets an `ActionTiming` into *Overdue* / *This week* / *Later* / *No date* and produces the timing label both apps show. `FIXED_DATE` buckets by whole days to the due date (past → Overdue, within 7 → This week, else Later). `RECURRING` computes a next occurrence only for `MONTHLY` with `dayOfMonth` — other cadences carry too little to compute honestly — and is never Overdue: a past cycle rolls forward to the next occurrence rather than reading as missed. `NOTICE_PERIOD` stays Later because its anchor is an event, not a date; `NONE` is No date. Labels are relative inside the week window ("Due in 3 days") and absolute beyond ("Due 31 Jul 2024").

Colour carries Urgency at item level in both apps — red for Overdue, orange for This week, neutral otherwise — using the AA text shades `--kt-danger-text` (`#d70015`) and `--kt-warning-text` (`#b35c00`) in `packages/theme/tokens.css`, with the bright tokens kept for shapes. Orange is never a category colour: the Guest's "Needs your attention" section identity is structural (its title — no caution glyph, #133), so its list borders and number circles stay neutral like Key Takeaways, and per-item Urgency shows only on the timing chip.

## Considered options

- **Each app classifies locally.** Rejected: the Host had already drifted (relative labels, urgency tints) from the Guest (absolute, neutral); duplication guarantees more of it.
- **A new shared package.** Rejected: two consumers and one pure function don't justify a package; `ActionTiming` already lives in `bus-contract`.
- **Urgency persisted on the Extraction.** Rejected: it decays every midnight — it's a read-time projection of `timing` against today.
- **Orange keeps meaning "Action Item".** Rejected: then the Guest's undated items look identical to due-soon ones, and the Host's This-week needs a third colour — the exact confusion the ticket existed to fix.

## Consequences

- `bus-contract` gains presentation-adjacent domain logic beyond wire types — accepted deliberately so the same item reads identically in both apps.
- The Guest's timing chip gains a clock (`today`) and urgency tint; Host's `classify`/`dueLabel` are replaced by the shared function.
- Per-occurrence completion and user-set `NOTICE_PERIOD` anchor dates are out of scope here: done-state is decided by [#134](https://github.com/JohnNooney/KlartextDMS/issues/134), which may revisit the never-Overdue rule for recurring items once a done signal exists.
