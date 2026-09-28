/**
 * Client-side input boundary for the first release (issue #18): Documents are
 * `application/pdf` ≤ 10 MB, and nothing else. Anything else rejects loudly
 * with the user-facing message — never a silent filter.
 */
import { MAX_DOCUMENT_BYTES } from './document';

export type InvalidDocumentReason = 'unsupported-type' | 'too-large';

export class InvalidDocumentFileError extends Error {
  constructor(readonly reason: InvalidDocumentReason) {
    super('Only PDF files are supported');
    this.name = 'InvalidDocumentFileError';
  }
}

/**
 * Throws `InvalidDocumentFileError` unless `file` is a PDF within the size
 * cap. Every path that picks or drops a File funnels through here.
 */
export function validateDocumentFile(file: File): void {
  if (file.type !== 'application/pdf') {
    throw new InvalidDocumentFileError('unsupported-type');
  }
  if (file.size > MAX_DOCUMENT_BYTES) {
    throw new InvalidDocumentFileError('too-large');
  }
}
