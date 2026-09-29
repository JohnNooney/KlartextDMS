/**
 * Document metadata schema (issue #9 resolution; `folderId` per #20): the
 * Firestore record at `users/{uid}/documents/{documentId}` behind the Host's
 * `DocumentRepository`. PDF bytes live in Storage at `storagePath`. The Guest
 * never sees this type — repositories are Host-only.
 */
import type { ExtractionErrorCode, Timestamp } from '@klartext/bus-contract';

/** The metadata-first machine (issues #9/#16): where a Document stands. */
export type DocumentStatus = 'uploading' | 'ready' | 'failed' | 'deleting';

/**
 * A recorded Extraction Job failure (issue #31, ADR 0008): the job axis's only
 * persisted state — `queued`/`running` are never persisted, so a Host reload
 * re-queues rather than resumes. A recorded failure is never auto-requeued;
 * `RETRY_EXTRACTION` clears it.
 */
export interface ExtractionFailure {
  code: ExtractionErrorCode;
  /** User-safe English carried over the Bus — never the raw SDK error. */
  message: string;
  retryable: boolean;
  failedAt: Timestamp;
}

export interface DocumentRecord {
  id: string;
  ownerId: string;
  title: string;
  /** Immutable provenance; `title` is the renamable label. */
  originalFilename: string;
  contentType: 'application/pdf';
  sizeBytes: number;
  /** `users/{uid}/documents/{documentId}.pdf` in Cloud Storage. */
  storagePath: string;
  status: DocumentStatus;
  /**
   * The last Extraction Job's recorded failure — the Session's `failed`
   * `extractionState` and the no-auto-requeue marker. Absent on Documents
   * written before the field existed; `null` means no recorded failure.
   */
  extractionFailure?: ExtractionFailure | null;
  /** `null` = root ("Documents"). */
  folderId: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** What the picker knows before any bytes land — input to `DocumentRepository.create`. */
export interface NewDocument {
  title: string;
  originalFilename: string;
  sizeBytes: number;
  folderId: string | null;
}

/** The decided upload ceiling (issue #9): 10 MB, `application/pdf` only. */
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
