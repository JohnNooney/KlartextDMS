import type { DocumentRecord } from '../data/document';

/**
 * The sibling set the reader's `‹ n of m ›` stepper walks (issue #29):
 * openable Documents filed in the same Folder, in the decided
 * `localeCompare(title, 'de')` order.
 */
export function siblingsOf(
  documents: readonly DocumentRecord[],
  folderId: string | null,
): DocumentRecord[] {
  return documents
    .filter((d) => d.status === 'ready' && d.folderId === folderId)
    .sort((a, b) => a.title.localeCompare(b.title, 'de'));
}

export interface Stepper {
  /** 0-based position of the open Document among its siblings. */
  index: number;
  total: number;
  prev: DocumentRecord | null;
  next: DocumentRecord | null;
}

export function stepperFor(
  siblings: readonly DocumentRecord[],
  documentId: string,
): Stepper | null {
  const index = siblings.findIndex((d) => d.id === documentId);
  if (index < 0) return null;
  return {
    index,
    total: siblings.length,
    prev: siblings[index - 1] ?? null,
    next: siblings[index + 1] ?? null,
  };
}
