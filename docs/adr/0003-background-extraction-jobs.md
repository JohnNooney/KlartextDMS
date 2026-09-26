---
status: accepted
---

# Extractions run as background Extraction Jobs, decoupled from viewing

The brief started the AI call when a Document was opened and hard-locked the Host's sidebar until it finished. We instead start an Extraction Job as soon as a Document is uploaded, so the user keeps browsing and is notified when it's done. Jobs have their own Bus messages, keyed by a job id rather than a Session, because the Document being extracted is usually not the one on screen. The Host queues jobs and sends them one at a time to the Guest iframe, which stays mounted (hidden) while the user is signed in; only the Guest may call Gemini (ADR 0001).

## Considered options

- **Reuse `INIT_SESSION` for jobs** by opening hidden Sessions. Rejected: breaks the single-current-Session rule that discards stale replies.
- **Parallel jobs.** Rejected for v1: multiplies quota and App Check pressure, and complicates the watchdogs, for little gain on a personal library.

## Consequences

- The sidebar lock is removed; `AI_PROCESSING_STARTED` no longer gates navigation.
- Jobs only run while a Host tab is open. The Host doesn't persist "running"; on load it re-queues every ready Document with no Extraction and no recorded failure.
- A failed job is recorded on the Document so it is not re-queued automatically; the user retries from the Guest.
