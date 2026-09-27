# @klartext/bus-contract

The shared contract for the Bus — the `window.postMessage` channel that is the
only way Host and Guest talk (issue #7, amended by #12; test surface per #13).
Types only, no runtime dependencies. Both apps consume the package via
source-level path mapping: no build step, no bundler artifact.

## Envelope

Every Bus message is `{ v, type, sessionId, payload }` with `v` fixed at `1`
and `payload` typed per `type` — `BusMessage` is a discriminated union, so
`switch (msg.type)` narrows the payload in both apps.

`sessionId` is Host-generated per `INIT_SESSION` and echoed by the Guest.
Messages outside a Session — `GUEST_READY` and every Extraction Job message —
carry `""` (`NO_SESSION`).

### Forward-compat rule

**Both apps ignore envelopes with an unknown `type`.** This is how a v1 peer
survives a v2 message such as `GUEST_SHOW_PAGE` or `AUTH_TOKEN_REFRESHED`.
`isEnvelope` accepts any well-formed spine; `isBusMessage` narrows to the
known v1 types — adapters dispatch on `isBusMessage` and must not throw or
reply for unknown types. The conformance suite pins this behaviour.

## Messages

| Direction | Type | Payload |
|---|---|---|
| Host → Guest | `INIT_SESSION` | `Session` — `{ sessionId, documentId, documentTitle, user, authToken (opaque), extraction, extractionState }`; never carries bytes, never starts an AI call |
| Host → Guest | `EXTRACT_DOCUMENT` | `{ jobId, document, bytes }` — bytes ride the postMessage transfer list |
| Guest → Host | `GUEST_READY` | `{}` — on mount and every reload; Host resends the Session and re-issues the in-flight job under a fresh `jobId` |
| Guest → Host | `SESSION_ACK` | `{}` — immediate, echoes the Session's `sessionId` |
| Guest → Host | `AI_PROCESSING_STARTED` | `{ jobId }` — the job ack, emitted before any AI work |
| Guest → Host | `AI_PROCESSING_SUCCESS` | `{ jobId, extraction }` — an `ExtractionCandidate`; the Host adds `createdAt` |
| Guest → Host | `AI_PROCESSING_ERROR` | `{ jobId, error }` — `ExtractionError { code, message, retryable }` |
| Guest → Host | `RETRY_EXTRACTION` | `{ documentId }` — the Guest holds no bytes after transfer |

Error codes: `AI_UNAVAILABLE`, `INVALID_EXTRACTION`, `QUOTA_EXCEEDED`,
`APP_CHECK_FAILED`, `UNKNOWN`.

Host watchdogs (all fail with `AI_UNAVAILABLE`, retryable): `SESSION_ACK`
within `SESSION_ACK_TIMEOUT_MS` (10 s) of `INIT_SESSION`;
`AI_PROCESSING_STARTED` within `JOB_START_TIMEOUT_MS` (10 s) of
`EXTRACT_DOCUMENT`; a result within `JOB_RESULT_TIMEOUT_MS` (120 s) of
`AI_PROCESSING_STARTED`. Late results for a stale `sessionId` or superseded
`jobId` are discarded. One job at a time; the Host owns the queue.

## Extraction types

`extraction.ts` carries the schema from issue #8 verbatim:
`DocumentType`, `KeyTakeaway`, `ExtractionContent`, `ExtractionGeneration`,
`ExtractionCandidate`, `ExtractionRecord` (`createdAt` is a structural
`Timestamp` — dependency-free, Firestore-compatible).

## Golden fixtures

`src/fixtures/*.json` — one canonical Envelope JSON per message type.
`EXTRACT_DOCUMENT.bytes` is base64 in JSON form (JSON cannot carry an
`ArrayBuffer`); `serializeEnvelope`/`deserializeEnvelope` are the reference
codec. Both apps' serializers must round-trip every fixture; the package's
own tests enforce it.

## Testing entry points

- `@klartext/bus-contract/testing` — `createLinkedBusPair()`: an in-memory
  `{ source, sink }` endpoint pair with `postMessage` semantics (synchronous
  delivery, `event.origin`/`event.source` stamping, real transfer detachment,
  `targetOrigin` drops). App Bus adapters take an injected `{ source, sink }`
  so unit tests never touch `window`. Also ships the loopback reference
  adapters used by the package's own conformance run.
- `@klartext/bus-contract/conformance` — `runBusContractConformance({ createHost, createGuest })`:
  the protocol suite each app runs in its own Vitest — handshake,
  Session-with-stored-Extraction, Extraction Job lifecycle, queueing,
  `RETRY_EXTRACTION`, Guest reload recovery, stale-`sessionId`/`jobId`
  discard, all three watchdogs, unknown-`type` ignored.

```ts
import { runBusContractConformance } from '@klartext/bus-contract/conformance';
import { createLinkedBusPair } from '@klartext/bus-contract/testing'; // same types the suite injects

runBusContractConformance({
  createHost: (ctx) => myHostBusAdapter(ctx),   // { source, sink, peerOrigin, probe }
  createGuest: (ctx) => myGuestBusAdapter(ctx), // + runJob — the suite's AI stand-in
});
```
