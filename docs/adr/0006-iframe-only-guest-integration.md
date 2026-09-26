---
status: accepted
---

# The Guest integrates only through a cross-origin iframe and the postMessage Bus

The Host (Angular) and the Guest (Vue) are two separate applications on separate origins, and the Guest renders inside an `<iframe>` in the Host. The only communication channel between them is the Bus: `window.postMessage` Envelopes `{ v, type, sessionId, payload }` checked against an origin and source allow-list (Bus contract v1). No Module Federation, no Web Components, no shared runtime — this separation is the point of the exercise: the project exists to rehearse embedding an acquired product into a legacy dashboard, so anything that dissolves the boundary defeats the purpose.

## Considered options

- **Module Federation / Web Components.** Rejected: they erase the cross-origin boundary the project exists to simulate, and couple the Guest's build and release cadence to the Host's.
- **Shared backend channel (Firestore listeners as the data plane).** Rejected: latency and a needless dependency for two frames on one page; the Bus is the data plane (ADR 0001) and Firebase access stays Host-side.

## Consequences

- Every cross-app capability is a Bus message; anything that can't cross `postMessage` (function calls, shared memory, DOM access) doesn't exist as far as the Guest is concerned.
- PDF bytes cross the Bus as a transferred `ArrayBuffer`; the Guest never touches Storage or Firestore.
- Preview channels create unpredictable Guest origins, so the Guest allows a `*.web.app` `frame-ancestors` wildcard and treats the Bus allow-list as the real security boundary (deployment topology, ADR 0004).
