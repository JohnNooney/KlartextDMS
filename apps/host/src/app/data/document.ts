/**
 * Document metadata schema (issue #9 resolution; `folderId` per #20): the
 * Firestore record at `users/{uid}/documents/{documentId}` behind the Host's
 * `DocumentRepository`. PDF bytes live in Storage at `storagePath`. The Guest
 * never sees this type — repositories are Host-only.
 */
import type { Timestamp } from '@klartext/bus-contract';

/** The metadata-first machine (issues #9/#16): where a Document stands. */
export type DocumentStatus = 'uploading' | 'ready' | 'failed' | 'deleting';

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
