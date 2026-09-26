---
status: accepted
---

# The Bus is the data plane: the Guest never touches Storage or Firestore

The Guest runs on a different origin than the Host, and Firebase Auth cannot share a session across origins: a forwarded ID token cannot sign the Guest's SDK in, and the Guest's own persistence is partitioned inside a cross-origin iframe (see `docs/research/auth-across-origins.md`). So instead of giving the Guest its own identity, the Host does all reads and writes of user data as the real user and the Bus carries the data: `INIT_SESSION` transfers the PDF bytes and any stored Extraction to the Guest; `AI_PROCESSING_SUCCESS` returns a new Extraction for the Host to persist. The Guest holds only an anonymous Firebase session, purely so App Check and Firebase AI Logic will accept its Gemini calls.

## Considered options

- **Guest gets a real identity via a custom-token Cloud Function** and reads Storage / writes Firestore itself. Rejected: reintroduces a backend the project set out to avoid, for no user-visible gain.
- **Host sends a `getDownloadURL` link; Guest writes Firestore as an anonymous uid** with loosened rules. Rejected: long-lived bearer URLs plus rules that cannot verify the owner.

## Consequences

- Firestore and Storage rules are owner-only by `uid` with no exceptions, because only the Host ever touches user data.
- `authToken` in the Session is opaque data (kept because the brief asks for it), not a credential; there is no token-refresh message in v1.
- PDFs cross `postMessage` as a transferred `ArrayBuffer`; the 20 MB Firebase AI Logic request cap is the effective upload cap.
- The Guest is a view-and-compute widget, not an independent product with its own persistence. If that ever changes, this decision is the one to revisit.
