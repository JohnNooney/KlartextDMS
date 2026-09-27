/**
 * @klartext/bus-contract — the shared contract for the Bus between Host and
 * Guest (issue #24). No runtime dependencies; both apps consume this package
 * via source-level path mapping, no build step.
 *
 * - `envelope.ts`    — `{ v, type, sessionId, payload }` spine.
 * - `extraction.ts`  — Extraction schema types (issue #8).
 * - `messages.ts`    — `BusMessage` discriminated union + guards (issue #7).
 * - `serialize.ts`   — reference JSON serializer; `EXTRACT_DOCUMENT` bytes are
 *                      base64 so every message has a canonical JSON form.
 * - `fixtures.ts`    — golden Envelope fixtures, one per message type.
 * - `@klartext/bus-contract/testing`     — `createLinkedBusPair()` fake
 *                      endpoints + reference loopback adapters.
 * - `@klartext/bus-contract/conformance` — the protocol conformance suite for
 *                      each app's own Vitest run (issue #13).
 */

export * from './envelope.js';
export * from './extraction.js';
export * from './messages.js';
export * from './serialize.js';
export * from './fixtures.js';
