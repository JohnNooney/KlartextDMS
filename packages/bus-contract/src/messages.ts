import type { ExtractionCandidate, ExtractionRecord } from './extraction.js';
import { BUS_PROTOCOL_VERSION, type Envelope } from './envelope.js';

/**
 * Bus messages (issue #7, amended by #12). `sessionId` is Host-generated per
 * `INIT_SESSION` and echoed by the Guest; messages outside a Session —
 * `GUEST_READY` and every Extraction Job message — carry `""` (`NO_SESSION`).
 *
 * Forward-compat rule: both apps ignore envelopes with an unknown `type`
 * (e.g. a v2 `GUEST_SHOW_PAGE` or `AUTH_TOKEN_REFRESHED`). `isEnvelope`
 * accepts them, `isBusMessage` does not.
 */

/** Payload shape for messages with no payload: `{}` on the wire. */
export type EmptyPayload = Record<string, never>;

export interface SessionUser {
  uid: string;
  displayName: string | null;
  email: string | null;
}

export type ExtractionState = 'none' | 'queued' | 'running' | 'failed';

/**
 * The context the Host hands the Guest when a Document is opened. A Session
 * never carries bytes and never starts an AI call — `extraction` is the
 * stored Extraction to display, `extractionState` how producing one stands.
 */
export interface Session {
  sessionId: string;
  documentId: string;
  documentTitle: string;
  user: SessionUser;
  /** Real Firebase ID token, OPAQUE DATA — never used as a credential. */
  authToken: string;
  extraction: ExtractionRecord | null;
  extractionState: ExtractionState;
}

/** The Document descriptor an Extraction Job carries (bytes travel beside it). */
export interface JobDocument {
  documentId: string;
  documentTitle: string;
  /** Always `'application/pdf'` in v1; the Guest needs it for the AI request. */
  contentType: string;
}

export type ExtractionErrorCode =
  | 'AI_UNAVAILABLE'
  | 'INVALID_EXTRACTION'
  | 'QUOTA_EXCEEDED'
  | 'APP_CHECK_FAILED'
  | 'UNKNOWN';

export interface ExtractionError {
  code: ExtractionErrorCode;
  /** User-safe English; never the raw SDK error. */
  message: string;
  retryable: boolean;
}

export interface ExtractDocumentPayload {
  jobId: string;
  document: JobDocument;
  /** PDF bytes; transferred (detached) on the real Bus. */
  bytes: ArrayBuffer;
}

export type BusMessage =
  // Host → Guest
  | Envelope<'INIT_SESSION', Session>
  | Envelope<'EXTRACT_DOCUMENT', ExtractDocumentPayload>
  // Guest → Host
  | Envelope<'GUEST_READY', EmptyPayload>
  | Envelope<'SESSION_ACK', EmptyPayload>
  | Envelope<'AI_PROCESSING_STARTED', { jobId: string }>
  | Envelope<'AI_PROCESSING_SUCCESS', { jobId: string; extraction: ExtractionCandidate }>
  | Envelope<'AI_PROCESSING_ERROR', { jobId: string; error: ExtractionError }>
  | Envelope<'RETRY_EXTRACTION', { documentId: string }>;

export type HostToGuestMessage = Extract<BusMessage, { type: 'INIT_SESSION' | 'EXTRACT_DOCUMENT' }>;
export type GuestToHostMessage = Exclude<BusMessage, HostToGuestMessage>;

/** Host watchdogs (issue #7, amended by #12): all failures surface as `AI_UNAVAILABLE`, retryable. */
export const SESSION_ACK_TIMEOUT_MS = 10_000;
export const JOB_START_TIMEOUT_MS = 10_000;
export const JOB_RESULT_TIMEOUT_MS = 120_000;

export type MessageType = BusMessage['type'];

export const MESSAGE_TYPES = [
  'INIT_SESSION',
  'EXTRACT_DOCUMENT',
  'GUEST_READY',
  'SESSION_ACK',
  'AI_PROCESSING_STARTED',
  'AI_PROCESSING_SUCCESS',
  'AI_PROCESSING_ERROR',
  'RETRY_EXTRACTION',
] as const satisfies readonly MessageType[];

/** Spine check only — accepts unknown `type`s so forward compat holds. */
export function isEnvelope(value: unknown): value is Envelope<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['v'] === BUS_PROTOCOL_VERSION &&
    typeof candidate['type'] === 'string' &&
    typeof candidate['sessionId'] === 'string' &&
    'payload' in candidate
  );
}

/** Envelope spine + a known v1 `type`. Unknown types return false — ignore them. */
export function isBusMessage(value: unknown): value is BusMessage {
  return isEnvelope(value) && (MESSAGE_TYPES as readonly string[]).includes(value.type);
}
