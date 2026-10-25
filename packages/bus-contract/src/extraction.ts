/**
 * Extraction schema — `klartext-extraction-v2` (issues #8, #99, ADR 0010). The
 * Guest creates and validates an `ExtractionCandidate` from Gemini's
 * structured output; the Host adds the Firestore server timestamp and
 * validates the candidate before persistence. Stored `schemaVersion: 1`
 * records are adapted on read by `normalizeExtractionRecord`.
 *
 * Types plus small dependency-free runtime helpers (wire guard, normalizer);
 * the canonical Zod validator lives with the Guest's extraction pipeline —
 * this package deliberately has no runtime schema dep (issue #13).
 */

export type DocumentType =
  | 'TENANCY_AGREEMENT'
  | 'HEALTH_INSURANCE'
  | 'EMPLOYMENT_CONTRACT'
  | 'INTERNET_OR_PHONE'
  | 'GOVERNMENT_LETTER'
  | 'OTHER';

/**
 * The user-facing English label for each `DocumentType` — shared (ADR 0012's
 * precedent) so the Guest's insights panel and the Host's library search name
 * a Document's type the same way.
 */
export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  TENANCY_AGREEMENT: 'Tenancy agreement',
  HEALTH_INSURANCE: 'Health insurance',
  EMPLOYMENT_CONTRACT: 'Employment contract',
  INTERNET_OR_PHONE: 'Internet or phone contract',
  GOVERNMENT_LETTER: 'Government letter',
  OTHER: 'Other',
};

/**
 * The Extraction's displayable Document type label: the free-text
 * `documentTypeLabel` for `OTHER`, the enum's shared label otherwise.
 */
export function documentTypeLabel(
  extraction: Pick<ExtractionContent, 'documentType' | 'documentTypeLabel'>,
): string {
  return extraction.documentType === 'OTHER'
    ? (extraction.documentTypeLabel ?? DOCUMENT_TYPE_LABELS.OTHER)
    : DOCUMENT_TYPE_LABELS[extraction.documentType];
}

export type ExtractionStatus = 'COMPLETE' | 'INSUFFICIENT_CONTENT' | 'UNSUPPORTED_DOCUMENT';

export type RecurrenceCadence = 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
export type NoticeUnit = 'DAYS' | 'WEEKS' | 'MONTHS' | 'YEARS';
export type ActionTimingKind = 'FIXED_DATE' | 'RECURRING' | 'NOTICE_PERIOD' | 'NONE';

export type ActionTiming =
  | { kind: 'FIXED_DATE'; dueDate: string }
  | {
      kind: 'RECURRING';
      cadence: RecurrenceCadence;
      dayOfMonth?: number;
      scheduleLabel: string;
    }
  | {
      kind: 'NOTICE_PERIOD';
      duration: number;
      unit: NoticeUnit;
      anchor: string;
    }
  | { kind: 'NONE' };

export interface ActionItem {
  text: string;
  /** Exact quotation from the Document; non-empty, ≤500 chars. */
  sourceQuote: string;
  /** One-based PDF page, when reliably determinable. */
  page?: number;
  timing: ActionTiming;
}

export interface KeyTakeaway {
  text: string;
  /** Exact quotation from the Document; non-empty, ≤500 chars. */
  sourceQuote: string;
  /** One-based PDF page, when reliably determinable. */
  page?: number;
}

/**
 * Cross-field rules enforced by validation, not by the type system:
 * - `documentTypeLabel` iff `documentType` is `OTHER`.
 * - `statusExplanation` iff `extractionStatus` is not `COMPLETE`; both lists
 *   are empty for non-`COMPLETE` statuses.
 * - `plainEnglishSummary` ≤200 words; `sourceLanguage` a BCP 47 tag.
 * - 0–6 `actionItems`, 0–10 `keyTakeaways`; the lists are mutually exclusive.
 * - `timing` carries only the fields of its `kind`.
 */
export interface ExtractionContent {
  documentType: DocumentType;
  documentTypeLabel?: string;
  sourceLanguage: string;
  plainEnglishSummary: string;
  extractionStatus: ExtractionStatus;
  statusExplanation?: string;
  actionItems: ActionItem[];
  keyTakeaways: KeyTakeaway[];
}

export interface TokenUsage {
  promptTokens: number;
  candidatesTokens: number;
  totalTokens: number;
}

export interface ExtractionGeneration {
  documentId: string;
  schemaVersion: 2;
  promptVersion: 'klartext-extraction-v2';
  model: string;
  usage?: TokenUsage;
}

export type ExtractionCandidate = ExtractionContent & ExtractionGeneration;

/**
 * Structural stand-in for `firebase/firestore`'s `Timestamp` so the contract
 * stays dependency-free. A real Firestore `Timestamp` (and the plain
 * `{seconds, nanoseconds}` object it degrades to over the Bus) both satisfy it.
 */
export interface Timestamp {
  seconds: number;
  nanoseconds: number;
}

/** An Action Item as consumers see it: the stored item plus its stable id. */
export type IdentifiedActionItem = ActionItem & { id: string };

interface ExtractionRecordMeta {
  documentId: string;
  schemaVersion: 1 | 2;
  promptVersion: 'klartext-extraction-v1' | 'klartext-extraction-v2';
  model: string;
  usage?: TokenUsage;
  createdAt: Timestamp;
}

/**
 * The record every consumer sees (ADR 0010): always the v2 shape, with stable
 * Action Item ids. A normalized v1 record keeps `schemaVersion: 1`.
 */
export type ExtractionRecord = Omit<ExtractionContent, 'actionItems'> &
  ExtractionRecordMeta & { actionItems: IdentifiedActionItem[] };

/** A v1 takeaway as stored before `klartext-extraction-v2`. */
export interface LegacyKeyTakeaway extends KeyTakeaway {
  importance: 'NORMAL' | 'CRITICAL';
}

export type LegacyExtractionRecordV1 = Omit<
  ExtractionContent,
  'actionItems' | 'keyTakeaways'
> &
  Omit<ExtractionRecordMeta, 'schemaVersion' | 'promptVersion'> & {
    schemaVersion: 1;
    promptVersion: 'klartext-extraction-v1';
    keyTakeaways: LegacyKeyTakeaway[];
  };

/** A record as persisted in Firestore: v1 as written, or v2 without ids. */
export type StoredExtractionRecord =
  | LegacyExtractionRecordV1
  | (ExtractionContent & ExtractionRecordMeta & { schemaVersion: 2; promptVersion: 'klartext-extraction-v2' });

function hashHex(input: string): string {
  // cyrb53: small, deterministic, dependency-free; ids need stability, not secrecy.
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

/** Stable Action Item id: hash of `sourceQuote` and timing kind (ADR 0010). */
export function actionItemId(item: Pick<ActionItem, 'sourceQuote' | 'timing'>): string {
  return `ai_${hashHex(`${item.sourceQuote}\u0000${item.timing.kind}`)}`;
}

/**
 * Adapts a stored Extraction to the v2 shape on read (ADR 0010); idempotent on
 * already-normalized records. v1 `CRITICAL`
 * takeaways become Action Items with `timing: NONE`, `NORMAL` ones stay Key
 * Takeaways; `schemaVersion` is preserved so the UI can offer re-analysis.
 */
export function normalizeExtractionRecord(
  record: StoredExtractionRecord | ExtractionRecord,
): ExtractionRecord {
  const identify = (items: ActionItem[]): IdentifiedActionItem[] =>
    items.map((item) => ({ ...item, id: actionItemId(item) }));
  if ('actionItems' in record) return { ...record, actionItems: identify(record.actionItems) };
  const actionItems: ActionItem[] = [];
  const keyTakeaways: KeyTakeaway[] = [];
  for (const { importance, ...takeaway } of record.keyTakeaways) {
    if (importance === 'CRITICAL') actionItems.push({ ...takeaway, timing: { kind: 'NONE' } });
    else keyTakeaways.push(takeaway);
  }
  return { ...record, actionItems: identify(actionItems), keyTakeaways };
}

const DOCUMENT_TYPE_VALUES: readonly DocumentType[] = [
  'TENANCY_AGREEMENT',
  'HEALTH_INSURANCE',
  'EMPLOYMENT_CONTRACT',
  'INTERNET_OR_PHONE',
  'GOVERNMENT_LETTER',
  'OTHER',
];

const EXTRACTION_STATUS_VALUES: readonly ExtractionStatus[] = [
  'COMPLETE',
  'INSUFFICIENT_CONTENT',
  'UNSUPPORTED_DOCUMENT',
];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const TIMING_KIND_VALUES: readonly ActionTimingKind[] = [
  'FIXED_DATE',
  'RECURRING',
  'NOTICE_PERIOD',
  'NONE',
];

function isKeyTakeaway(value: unknown): value is KeyTakeaway {
  if (!isObject(value)) return false;
  return (
    typeof value['text'] === 'string' &&
    typeof value['sourceQuote'] === 'string' &&
    (value['page'] === undefined || typeof value['page'] === 'number')
  );
}

function isActionItem(value: unknown): value is ActionItem {
  return (
    isKeyTakeaway(value) &&
    isObject((value as unknown as ActionItem).timing) &&
    TIMING_KIND_VALUES.includes((value as unknown as ActionItem).timing.kind)
  );
}

/**
 * Wire-level structural check for an `ExtractionCandidate` arriving in
 * `AI_PROCESSING_SUCCESS` (issue #31): required fields present, enums in
 * range, generation metadata intact. The content rules — word caps, BCP 47,
 * conditional fields — stay with the Guest's Zod validator (issue #8); the
 * Host never persists a candidate that fails this spine (#15: partial or
 * schema-invalid Extractions are never persisted).
 */
export function isExtractionCandidate(value: unknown): value is ExtractionCandidate {
  if (!isObject(value)) return false;
  return (
    typeof value['documentId'] === 'string' &&
    value['schemaVersion'] === 2 &&
    value['promptVersion'] === 'klartext-extraction-v2' &&
    typeof value['model'] === 'string' &&
    DOCUMENT_TYPE_VALUES.includes(value['documentType'] as DocumentType) &&
    (value['documentTypeLabel'] === undefined ||
      typeof value['documentTypeLabel'] === 'string') &&
    typeof value['sourceLanguage'] === 'string' &&
    typeof value['plainEnglishSummary'] === 'string' &&
    EXTRACTION_STATUS_VALUES.includes(value['extractionStatus'] as ExtractionStatus) &&
    (value['statusExplanation'] === undefined ||
      typeof value['statusExplanation'] === 'string') &&
    Array.isArray(value['actionItems']) &&
    value['actionItems'].every(isActionItem) &&
    Array.isArray(value['keyTakeaways']) &&
    value['keyTakeaways'].every(isKeyTakeaway)
  );
}
