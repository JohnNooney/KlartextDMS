---
status: accepted
---

# Translations run as on-demand Bus jobs and persist page by page

A full literal Translation is started by the user, not on upload, so Gemini spend follows reading intent. It runs as a `TRANSLATE_DOCUMENT` job on the same serial queue as Extraction Jobs (ADR 0003), with the Guest batching pages internally (~5 per Gemini call) and streaming `TRANSLATION_PROGRESS` to the Host. The Host alone persists (ADR 0001): a metadata doc at `users/{uid}/documents/{documentId}/translations/current` plus one doc per page at `translations/current/pages/{pageNumber}`.

## Considered options

- **One `translations/current` doc.** Rejected: 1 MiB cap vs. a 100-page ceiling, and no incremental persistence, so a failed batch loses finished pages.
- **Host slices the PDF into one job per page range.** Rejected: needs a PDF-slicing dependency in the Host; the Guest already holds the bytes.
- **Separate queue lane for Translations.** Rejected: multiplies quota and App Check pressure, same reason parallel Extraction Jobs were rejected.
- **`pdf.js` `TextLayer` overlay.** Rejected (research): breaks on multi-line clauses, text expansion, and scanned PDFs.

## Consequences

- `firestore.rules` gains `match /translations/{translationId}` and `/pages/{pageId}` under a Document.
- A `partial` metadata doc with no live job means "incomplete, resume from `pagesDone`".
- A Translation is never an input to Extractions.
