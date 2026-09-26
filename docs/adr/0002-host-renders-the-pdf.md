---
status: accepted
---

# The Host renders the PDF; the Guest is an insights panel

The brief made the Guest a split-screen "document viewer and data extractor". We moved the PDF view into the Host: the Host already holds the bytes (ADR 0001), and a Files-style library that opens Documents in place reads as one product only if the Host owns the reading surface. The Guest keeps what makes it the acquired product: producing Extractions with Gemini and presenting them beside the Host's PDF view.

## Consequences

- Opening a Document whose Extraction is stored sends no bytes over the Bus; bytes travel only in Extraction Jobs (ADR 0003).
- The PDF viewer is a Host (Angular) concern.
- Evidence links from a Key Takeaway to a PDF page need a Guest → Host message; deferred to Bus v2 (issue #19).
- The Host keeps its own copy of any bytes it transfers, since transferring detaches the `ArrayBuffer`.
