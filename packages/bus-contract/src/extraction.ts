/**
 * Extraction schema — verbatim from issue #8 ("Extraction schema and Gemini
 * structured output"). The Guest creates and validates an `ExtractionCandidate`
 * from Gemini's structured output; the Host adds the Firestore server
 * timestamp and validates the `ExtractionRecord` before persistence.
 *
 * Types only: the canonical runtime (Zod) validator lands with the Guest's
 * extraction pipeline; this package deliberately has no runtime schema dep
 * (issue #13).
 */

export type DocumentType =
  | 'TENANCY_AGREEMENT'
  | 'HEALTH_INSURANCE'
  | 'EMPLOYMENT_CONTRACT'
  | 'INTERNET_OR_PHONE'
  | 'GOVERNMENT_LETTER'
  | 'OTHER';

export type TakeawayImportance = 'NORMAL' | 'CRITICAL';

export interface KeyTakeaway {
  text: string;
  importance: TakeawayImportance;
  /** Exact quotation from the Document; non-empty, ≤500 chars. */
  sourceQuote: string;
  /** One-based PDF page, when reliably determinable. */
  page?: number;
}

export type ExtractionStatus = 'COMPLETE' | 'INSUFFICIENT_CONTENT' | 'UNSUPPORTED_DOCUMENT';

/**
 * Cross-field rules enforced by validation, not by the type system:
 * - `documentTypeLabel` iff `documentType` is `OTHER`.
 * - `statusExplanation` iff `extractionStatus` is not `COMPLETE`.
 * - `plainEnglishSummary` ≤200 words; `sourceLanguage` a BCP 47 tag.
 * - 0–12 `keyTakeaways`, at most 5 `CRITICAL`.
 */
export interface ExtractionContent {
  documentType: DocumentType;
  documentTypeLabel?: string;
  sourceLanguage: string;
  plainEnglishSummary: string;
  extractionStatus: ExtractionStatus;
  statusExplanation?: string;
  keyTakeaways: KeyTakeaway[];
}

export interface TokenUsage {
  promptTokens: number;
  candidatesTokens: number;
  totalTokens: number;
}

export interface ExtractionGeneration {
  documentId: string;
  schemaVersion: 1;
  promptVersion: 'klartext-extraction-v1';
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

export type ExtractionRecord = ExtractionCandidate & { createdAt: Timestamp };

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

const TAKEAWAY_IMPORTANCE_VALUES: readonly TakeawayImportance[] = ['NORMAL', 'CRITICAL'];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isKeyTakeaway(value: unknown): value is KeyTakeaway {
  if (!isObject(value)) return false;
  return (
    typeof value['text'] === 'string' &&
    TAKEAWAY_IMPORTANCE_VALUES.includes(value['importance'] as TakeawayImportance) &&
    typeof value['sourceQuote'] === 'string' &&
    (value['page'] === undefined || typeof value['page'] === 'number')
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
    value['schemaVersion'] === 1 &&
    value['promptVersion'] === 'klartext-extraction-v1' &&
    typeof value['model'] === 'string' &&
    DOCUMENT_TYPE_VALUES.includes(value['documentType'] as DocumentType) &&
    (value['documentTypeLabel'] === undefined ||
      typeof value['documentTypeLabel'] === 'string') &&
    typeof value['sourceLanguage'] === 'string' &&
    typeof value['plainEnglishSummary'] === 'string' &&
    EXTRACTION_STATUS_VALUES.includes(value['extractionStatus'] as ExtractionStatus) &&
    (value['statusExplanation'] === undefined ||
      typeof value['statusExplanation'] === 'string') &&
    Array.isArray(value['keyTakeaways']) &&
    value['keyTakeaways'].every(isKeyTakeaway)
  );
}
