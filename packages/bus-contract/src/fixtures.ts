import guestReady from './fixtures/guest-ready.json';
import initSession from './fixtures/init-session.json';
import extractDocument from './fixtures/extract-document.json';
import sessionAck from './fixtures/session-ack.json';
import aiProcessingStarted from './fixtures/ai-processing-started.json';
import aiProcessingSuccess from './fixtures/ai-processing-success.json';
import aiProcessingError from './fixtures/ai-processing-error.json';
import retryExtraction from './fixtures/retry-extraction.json';
import panelPresentation from './fixtures/panel-presentation.json';
import guestShowPage from './fixtures/guest-show-page.json';
import guestExpandPanel from './fixtures/guest-expand-panel.json';
import guestCreateReminder from './fixtures/guest-create-reminder.json';
import guestSetActionItemDone from './fixtures/guest-set-action-item-done.json';
import actionItemStates from './fixtures/action-item-states.json';
import extractionsJson from './fixtures/extractions.json';
import extractionsV1Json from './fixtures/extractions-v1.json';
import type { BusMessage, MessageType } from './messages.js';
import type { ExtractionCandidate, LegacyExtractionRecordV1 } from './extraction.js';
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
  PANEL_PRESENTATION: panelPresentation,
  GUEST_SHOW_PAGE: guestShowPage,
  GUEST_EXPAND_PANEL: guestExpandPanel,
  GUEST_CREATE_REMINDER: guestCreateReminder,
  GUEST_SET_ACTION_ITEM_DONE: guestSetActionItemDone,
  ACTION_ITEM_STATES: actionItemStates,
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

/**
 * The seeded fixture Extractions, keyed by documentId (issues #9, #30).
 * `scripts/seed.mjs` persists this same file into the emulator and the
 * Guest's fake AI provider serves it byte-for-byte; the Guest validates each
 * candidate against the #8 rules before returning it, so the cast stays
 * honest.
 */
export const seededExtractionFixtures =
  extractionsJson as unknown as Record<string, ExtractionCandidate>;

/**
 * `schemaVersion: 1` Extractions as stored before `klartext-extraction-v2`,
 * keyed by documentId minus `createdAt` (ADR 0010). `scripts/seed.mjs` seeds
 * `doc-versicherungsschein` from this file to exercise read-time normalization.
 */
export const legacyV1ExtractionFixtures =
  extractionsV1Json as unknown as Record<string, Omit<LegacyExtractionRecordV1, 'createdAt'>>;
