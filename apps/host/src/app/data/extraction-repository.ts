/**
 * Host-only persistence for the current Extraction (ADR 0008, issue #27).
 * One Extraction per Document, stored at
 * `users/{uid}/documents/{documentId}/extractions/current` and reused on every
 * open; re-analysis replaces it. The Host adds the Firestore server
 * timestamp; the Guest never touches Firestore (ADR 0001).
 */
import type { ExtractionCandidate, ExtractionRecord } from '@klartext/bus-contract';
import { getDoc, serverTimestamp, setDoc, type Firestore } from 'firebase/firestore';
import { extractionRef } from './paths';

export interface ExtractionRepository {
  /** The stored Extraction, or `null` when the Document has none yet. */
  get(documentId: string): Promise<ExtractionRecord | null>;
  /** Persists `extraction` as the current Extraction, replacing any prior one. */
  save(documentId: string, extraction: ExtractionCandidate): Promise<void>;
}

export class FirestoreExtractionRepository implements ExtractionRepository {
  constructor(
    private readonly firestore: Firestore,
    private readonly ownerId: string,
  ) {}

  async get(documentId: string): Promise<ExtractionRecord | null> {
    const snap = await getDoc(extractionRef(this.firestore, this.ownerId, documentId));
    return snap.exists() ? (snap.data() as ExtractionRecord) : null;
  }

  async save(documentId: string, extraction: ExtractionCandidate): Promise<void> {
    await setDoc(extractionRef(this.firestore, this.ownerId, documentId), {
      ...dropUndefined(extraction),
      createdAt: serverTimestamp(),
    });
  }
}

/**
 * Firestore rejects explicit `undefined` field values — and the Guest's
 * schema validation emits optional contract fields (`documentTypeLabel`,
 * `statusExplanation`, takeaway `page`) as own-`undefined` properties, which
 * `postMessage`'s structured clone preserves. Absent and `undefined` mean
 * the same thing on the wire; drop them at the persistence boundary.
 */
function dropUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map(dropUndefined) as T;
  if (value !== null && typeof value === 'object' && value.constructor === Object) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, dropUndefined(v)]),
    ) as T;
  }
  return value;
}
