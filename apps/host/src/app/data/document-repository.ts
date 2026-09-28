/**
 * Host-only Document persistence (issues #9, #27). The narrow interface the
 * upload pipeline and library UI talk to; the Firebase implementation
 * receives initialized SDK instances through its constructor and is the same
 * code in production and against the emulators — no env reads, no global
 * initialization. The Guest has no repository (ADR 0001).
 */
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  type CollectionReference,
  type DocumentReference,
  type Firestore,
} from 'firebase/firestore';
import { deleteObject, getBytes, ref, uploadBytesResumable, type FirebaseStorage } from 'firebase/storage';
import { MAX_DOCUMENT_BYTES, type DocumentRecord, type DocumentStatus, type NewDocument } from './document';
import { extractionRef } from './paths';

/**
 * An abortable Storage upload (issue #16): `cancel()` aborts the task —
 * `result` then rejects with `storage/canceled`.
 */
export interface DocumentUpload {
  cancel(): void;
  result: Promise<void>;
}

export interface DocumentRepository {
  /** Every Document in the owner's library, upload order first. */
  list(): Promise<DocumentRecord[]>;
  /** Writes `uploading` metadata — the metadata-first machine's first step. */
  create(input: NewDocument): Promise<DocumentRecord>;
  /** The stored PDF bytes. */
  getBytes(documentId: string): Promise<ArrayBuffer>;
  /**
   * Tears the Document down in the decided order — bytes → Extraction →
   * metadata (#9/#16) — leaving no trace. Idempotent, so an interrupted
   * `deleting` re-runs to completion.
   */
  delete(documentId: string): Promise<void>;
  /** Marks a machine transition (`ready`, `failed`, `deleting`, …). */
  setStatus(documentId: string, status: DocumentStatus): Promise<void>;
  /** Starts the abortable Storage upload of the Document's bytes. */
  uploadBytes(
    documentId: string,
    data: Blob,
    onProgress?: (bytesTransferred: number, totalBytes: number) => void,
  ): DocumentUpload;
}

export class FirestoreDocumentRepository implements DocumentRepository {
  constructor(
    private readonly firestore: Firestore,
    private readonly storage: FirebaseStorage,
    private readonly ownerId: string,
  ) {}

  private get documents(): CollectionReference {
    return collection(this.firestore, 'users', this.ownerId, 'documents');
  }

  private metadataRef(documentId: string): DocumentReference {
    return doc(this.documents, documentId);
  }

  storagePath(documentId: string): string {
    return `users/${this.ownerId}/documents/${documentId}.pdf`;
  }

  async list(): Promise<DocumentRecord[]> {
    const snap = await getDocs(query(this.documents, orderBy('createdAt')));
    return snap.docs.map((d) => d.data() as DocumentRecord);
  }

  async create(input: NewDocument): Promise<DocumentRecord> {
    const ref = doc(this.documents);
    const record = {
      id: ref.id,
      ownerId: this.ownerId,
      title: input.title,
      originalFilename: input.originalFilename,
      contentType: 'application/pdf' as const,
      sizeBytes: input.sizeBytes,
      storagePath: this.storagePath(ref.id),
      status: 'uploading' as const,
      folderId: input.folderId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    await setDoc(ref, record);
    // Read back for the server timestamps — tiles render them immediately.
    return (await getDoc(ref)).data() as DocumentRecord;
  }

  /** Marks a machine transition; bumps `updatedAt`. */
  async setStatus(documentId: string, status: DocumentStatus): Promise<void> {
    await updateDoc(this.metadataRef(documentId), { status, updatedAt: serverTimestamp() });
  }

  async getBytes(documentId: string): Promise<ArrayBuffer> {
    // The browser SDK resolves a Blob; the Node build (integration tests)
    // resolves the ArrayBuffer directly — accept both.
    const data = (await getBytes(
      ref(this.storage, this.storagePath(documentId)),
      MAX_DOCUMENT_BYTES,
    )) as Blob | ArrayBuffer;
    return data instanceof ArrayBuffer ? data : data.arrayBuffer();
  }

  /**
   * Starts a resumable Storage upload to the Document's path. Returns the
   * abortable task: `cancel()` aborts (rejecting `result` with
   * `storage/canceled`); `result` settles when the bytes land.
   */
  uploadBytes(
    documentId: string,
    data: Blob,
    onProgress?: (bytesTransferred: number, totalBytes: number) => void,
  ): DocumentUpload {
    const task = uploadBytesResumable(ref(this.storage, this.storagePath(documentId)), data, {
      // The literal is the rule (issue #18): PDF only, first release.
      contentType: 'application/pdf',
    });
    task.on('state_changed', (snapshot) =>
      onProgress?.(snapshot.bytesTransferred, snapshot.totalBytes),
    );
    return {
      cancel: () => task.cancel(),
      result: (async () => {
        await task;
      })(),
    };
  }

  async delete(documentId: string): Promise<void> {
    // The decided order (issues #9/#16): bytes first, metadata last, so an
    // interrupted `deleting` can be re-run to completion. Every stage is
    // idempotent — a missing object or document is success, not failure.
    await this.deleteBytes(documentId);
    await this.deleteExtraction(documentId);
    await this.deleteMetadata(documentId);
  }

  /** Teardown stage 1: the PDF bytes in Storage. */
  protected async deleteBytes(documentId: string): Promise<void> {
    try {
      await deleteObject(ref(this.storage, this.storagePath(documentId)));
    } catch (err) {
      // Already gone — a prior run got this far (retryable deletion).
      if (!isStorageError(err, 'object-not-found')) throw err;
    }
  }

  /** Teardown stage 2: the current Extraction (`extractions/current`). */
  protected async deleteExtraction(documentId: string): Promise<void> {
    await deleteDoc(extractionRef(this.firestore, this.ownerId, documentId));
  }

  /** Teardown stage 3: the metadata, last. */
  protected async deleteMetadata(documentId: string): Promise<void> {
    await deleteDoc(this.metadataRef(documentId));
  }
}

/** Firebase Storage errors carry `code: "storage/<code>"` (also used by the pipeline). */
export function isStorageError(err: unknown, code: string): boolean {
  return (err as { code?: string }).code === `storage/${code}`;
}