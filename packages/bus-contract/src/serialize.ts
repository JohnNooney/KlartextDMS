import { isEnvelope } from './messages.js';
import { BUS_PROTOCOL_VERSION, type Envelope } from './envelope.js';

/**
 * Reference serializer — the canonical JSON form of an Envelope, used by the
 * golden fixtures (`src/fixtures/`) and by both apps' round-trip tests.
 *
 * `EXTRACT_DOCUMENT` carries an `ArrayBuffer`, which JSON cannot represent;
 * on the wire form it is encoded as a base64 string. Everything else maps
 * 1:1. Unknown `type`s pass through untouched — see the forward-compat rule
 * in `messages.ts`.
 */

type JsonObject = Record<string, unknown>;

function bytesToBase64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let binary = '';
  for (const b of view) binary += String.fromCharCode(b);
  return btoa(binary);
}

function base64ToBytes(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const view = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) view[i] = binary.charCodeAt(i);
  return view.buffer;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Canonical JSON-safe form of an Envelope (bytes → base64). Does not mutate. */
export function toJsonEnvelope(message: Envelope<string, unknown>): JsonObject {
  let payload = message.payload;
  if (
    message.type === 'EXTRACT_DOCUMENT' &&
    isObject(payload) &&
    payload['bytes'] instanceof ArrayBuffer
  ) {
    payload = { ...payload, bytes: bytesToBase64(payload['bytes']) };
  }
  return { v: message.v, type: message.type, sessionId: message.sessionId, payload };
}

/** Inverse of {@link toJsonEnvelope} (base64 → bytes for EXTRACT_DOCUMENT). */
export function fromJsonEnvelope(json: Envelope<string, unknown>): Envelope<string, unknown> {
  if (json.type === 'EXTRACT_DOCUMENT' && isObject(json.payload)) {
    const bytes = json.payload['bytes'];
    if (typeof bytes === 'string') {
      return { ...json, payload: { ...json.payload, bytes: base64ToBytes(bytes) } };
    }
  }
  return json;
}

export function serializeEnvelope(message: Envelope<string, unknown>): string {
  return JSON.stringify(toJsonEnvelope(message));
}

/**
 * Parses an Envelope from its canonical JSON form. Throws if the value is not
 * a well-formed Envelope spine; unknown `type`s are returned as-is.
 */
export function deserializeEnvelope(json: string): Envelope<string, unknown> {
  const parsed: unknown = JSON.parse(json);
  if (!isEnvelope(parsed)) {
    throw new Error(
      `Not a Bus envelope: expected { v: ${BUS_PROTOCOL_VERSION}, type: string, sessionId: string, payload }`,
    );
  }
  return fromJsonEnvelope(parsed);
}
