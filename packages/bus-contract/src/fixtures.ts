import guestReady from './fixtures/guest-ready.json';
import initSession from './fixtures/init-session.json';
import extractDocument from './fixtures/extract-document.json';
import sessionAck from './fixtures/session-ack.json';
import aiProcessingStarted from './fixtures/ai-processing-started.json';
import aiProcessingSuccess from './fixtures/ai-processing-success.json';
import aiProcessingError from './fixtures/ai-processing-error.json';
import retryExtraction from './fixtures/retry-extraction.json';
import type { BusMessage, MessageType } from './messages.js';
import { deserializeEnvelope } from './serialize.js';

/**
 * Golden Envelope fixtures — one canonical JSON document per message type.
 * Both apps' serializers must round-trip them:
 * `JSON.parse(serializeEnvelope(deserializeEnvelope(JSON.stringify(f))))` deep-equals `f`.
 */
export const goldenFixtures = {
  GUEST_READY: guestReady,
  INIT_SESSION: initSession,
  EXTRACT_DOCUMENT: extractDocument,
  SESSION_ACK: sessionAck,
  AI_PROCESSING_STARTED: aiProcessingStarted,
  AI_PROCESSING_SUCCESS: aiProcessingSuccess,
  AI_PROCESSING_ERROR: aiProcessingError,
  RETRY_EXTRACTION: retryExtraction,
} as const satisfies Record<MessageType, unknown>;

/**
 * The fixtures decoded into typed `BusMessage`s — ready-made sample data for
 * tests and fake providers.
 */
export const goldenFixtureMessages = Object.fromEntries(
  Object.entries(goldenFixtures).map(([type, json]) => [
    type,
    deserializeEnvelope(JSON.stringify(json)),
  ]),
) as unknown as { [T in MessageType]: Extract<BusMessage, { type: T }> };
