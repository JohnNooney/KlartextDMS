import type { ExtractionCandidate, ExtractionRecord } from './extraction.js';
import { BUS_PROTOCOL_VERSION, type Envelope } from './envelope.js';

/**
 * Bus messages (issue #7, amended by #12). `sessionId` is Host-generated per
 * `INIT_SESSION` and echoed by the Guest; messages outside a Session —
 * `GUEST_READY`, `PANEL_PRESENTATION` (issue #77), and every Extraction Job
 * message — carry `""` (`NO_SESSION`). `GUEST_SHOW_PAGE` (issue #78),
 * `GUEST_EXPAND_PANEL` (issue #79), and `GUEST_CREATE_REMINDER` (issue #122)
 * travel inside the Session: the Host drops them for any other `sessionId`.
 *
 * Forward-compat rule: both apps ignore envelopes with an unknown `type`
 * (e.g. a v2 `AUTH_TOKEN_REFRESHED`). `isEnvelope` accepts them,
 * `isBusMessage` does not.
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

/**
 * How the Host presents the Guest frame (issue #77): the desktop insights
 * lane or the mobile bottom sheet. The Guest can't tell from its own
 * viewport — the lane (~440px) and the sheet (~390px) are nearly the same
 * width — so the Host says so explicitly. Presentation is per-frame, not
 * per-Session, so `PANEL_PRESENTATION` carries `sessionId: ""` (`NO_SESSION`).
 */
export type PanelPresentation = 'lane' | 'sheet';

export function isPanelPresentation(value: unknown): value is PanelPresentation {
  return value === 'lane' || value === 'sheet';
}

/**
 * The Guest asks the Host to show a page of the open Document (issue #78):
 * a selected Key Takeaway row's one-based `page`, its `sourceQuote` as
 * `quote`, and `critical` for Critical Warnings. `quote`/`critical` feed
 * the Host's passage highlight (issue #80) — its target and its tint.
 */
export interface GuestShowPagePayload {
  /** One-based page of the open Document. */
  page: number;
  quote?: string;
  critical?: boolean;
}

/**
 * The Guest asks the Host to export a Reminder for an Action Item (issue
 * #122): the item's stable id only — the Session already binds the
 * Document. The Host resolves the item from `extractionsByDocId` and owns
 * the whole flow (confirm dialog, `.ics`, Google link); fire-and-forget
 * like `GUEST_SHOW_PAGE`, since Klartext never tracks a Reminder.
 */
export interface GuestCreateReminderPayload {
  /** The Action Item's Host-computed stable id (`actionItemId`). */
  actionItemId: string;
}

/**
 * A vetted reminder request as the Host sees it: the Session's Document
 * (the envelope carried no `documentId` — the adapter binds it) plus the
 * Action Item's id within its Extraction.
 */
export interface ReminderRequest extends GuestCreateReminderPayload {
  documentId: string;
}

export type BusMessage =
  // Host → Guest
  | Envelope<'INIT_SESSION', Session>
  | Envelope<'EXTRACT_DOCUMENT', ExtractDocumentPayload>
  | Envelope<'PANEL_PRESENTATION', { mode: PanelPresentation }>
  // Guest → Host
  | Envelope<'GUEST_READY', EmptyPayload>
  | Envelope<'SESSION_ACK', EmptyPayload>
  | Envelope<'AI_PROCESSING_STARTED', { jobId: string }>
  | Envelope<'AI_PROCESSING_SUCCESS', { jobId: string; extraction: ExtractionCandidate }>
  | Envelope<'AI_PROCESSING_ERROR', { jobId: string; error: ExtractionError }>
  | Envelope<'RETRY_EXTRACTION', { documentId: string }>
  | Envelope<'GUEST_SHOW_PAGE', GuestShowPagePayload>
  | Envelope<'GUEST_EXPAND_PANEL', EmptyPayload>
  | Envelope<'GUEST_CREATE_REMINDER', GuestCreateReminderPayload>;

export type HostToGuestMessage = Extract<
  BusMessage,
  { type: 'INIT_SESSION' | 'EXTRACT_DOCUMENT' | 'PANEL_PRESENTATION' }
>;
export type GuestToHostMessage = Exclude<BusMessage, HostToGuestMessage>;

/** Host watchdogs (issue #7, amended by #12): all failures surface as `AI_UNAVAILABLE`, retryable. */
export const SESSION_ACK_TIMEOUT_MS = 10_000;
export const JOB_START_TIMEOUT_MS = 10_000;
export const JOB_RESULT_TIMEOUT_MS = 120_000;

export type MessageType = BusMessage['type'];

export const MESSAGE_TYPES = [
  'INIT_SESSION',
  'EXTRACT_DOCUMENT',
  'PANEL_PRESENTATION',
  'GUEST_READY',
  'SESSION_ACK',
  'AI_PROCESSING_STARTED',
  'AI_PROCESSING_SUCCESS',
  'AI_PROCESSING_ERROR',
  'RETRY_EXTRACTION',
  'GUEST_SHOW_PAGE',
  'GUEST_EXPAND_PANEL',
  'GUEST_CREATE_REMINDER',
] as const satisfies readonly MessageType[];

/**
 * Wire-level check for `GUEST_SHOW_PAGE` (issue #78): the `page` is an
 * integer ≥ 1 — the `..pageCount` end of the range is the app's, which alone
 * knows the open Document. A non-string `quote` or non-boolean `critical`
 * is stripped rather than killing an otherwise valid request. Returns the
 * sanitized payload, or `null` when the page itself can't be honoured.
 */
export function sanitizeShowPage(payload: unknown): GuestShowPagePayload | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const page = (payload as Record<string, unknown>)['page'];
  if (typeof page !== 'number' || !Number.isInteger(page) || page < 1) return null;
  const quote = (payload as Record<string, unknown>)['quote'];
  const critical = (payload as Record<string, unknown>)['critical'];
  return {
    page,
    quote: typeof quote === 'string' ? quote : undefined,
    critical: typeof critical === 'boolean' ? critical : undefined,
  };
}

/**
 * Wire-level check for `GUEST_CREATE_REMINDER` (issue #122): a non-empty
 * string `actionItemId` — the Host resolves items from
 * `extractionsByDocId`, so anything else can't be honoured and drops the
 * message. Extras are stripped, like `sanitizeShowPage`.
 */
export function sanitizeCreateReminder(payload: unknown): GuestCreateReminderPayload | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const actionItemId = (payload as Record<string, unknown>)['actionItemId'];
  if (typeof actionItemId !== 'string' || actionItemId.length === 0) return null;
  return { actionItemId };
}

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

/**
 * Structural check for the `ExtractionError` shape — used by Guest adapters
 * to decide whether a `runJob` rejection already carries a user-safe error
 * or needs wrapping as `UNKNOWN`.
 */
export function isExtractionError(value: unknown): value is ExtractionError {
  if (typeof value !== 'object' || value === null) return false;
  const e = value as Record<string, unknown>;
  return (
    typeof e['code'] === 'string' &&
    typeof e['message'] === 'string' &&
    typeof e['retryable'] === 'boolean'
  );
}
