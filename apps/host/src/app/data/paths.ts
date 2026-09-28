/**
 * Firestore paths for the Host's data model (issue #9/#27) — the single
 * source for the shapes both repositories write to, so they cannot drift.
 */
import { doc, type DocumentReference, type Firestore } from 'firebase/firestore';

/** The current Extraction (ADR 0008): one per Document, fixed identity. */
export function extractionRef(
  firestore: Firestore,
  ownerId: string,
  documentId: string,
): DocumentReference {
  return doc(firestore, 'users', ownerId, 'documents', documentId, 'extractions', 'current');
}
