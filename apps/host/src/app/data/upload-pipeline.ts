/**
 * The metadata-first upload machine (issues #9, #16, #27). Orchestrates the
 * Host-only repositories: `uploading` → `ready` on success, `failed` on error
 * (metadata retained for retry), cancel deletes metadata plus partial bytes,
 * and delete tears down bytes → Extraction → metadata, retryable. Uploads run
 * concurrently, each with its own progress; Storage tasks are abortable.
 *
 * Startup reconciliation: an `uploading` Document with no live task (the tab
 * died mid-upload) is marked `failed`; a `deleting` Document re-runs its
 * teardown to completion.
 */
import type { DocumentRecord } from './document';
import { validateDocumentFile } from './document-input';
import {
  isStorageError,
  type DocumentRepository,
  type DocumentUpload,
} from './document-repository';

export interface UploadOptions {
  /** Destination Folder; `null`/omitted is root ("Documents"). */
  folderId?: string | null;
  /** Per-upload progress, as a 0–1 fraction of the bytes. */
  onProgress?: (documentId: string, fraction: number) => void;
}

export interface UploadHandle {
  readonly documentId: string;
  /** Settles at `ready`; rejects on failure (status `failed`) or cancellation. */
  readonly completion: Promise<void>;
  /** Aborts the Storage task and deletes metadata plus partial bytes. */
  cancel(): void;
}

export class UploadCancelledError extends Error {
  constructor(documentId: string) {
    super(`Upload of ${documentId} was cancelled`);
    this.name = 'UploadCancelledError';
  }
}

export class UploadPipeline {
  private readonly live = new Map<string, DocumentUpload>();
  /**
   * The `File` behind each in-session upload (issue #16): a `failed` Document
   * can be retried through ⋮ → Retry upload only while the session holds the
   * handle — after a reload, drop-to-retry is the only path.
   */
  private readonly heldFiles = new Map<string, File>();

  constructor(private readonly documents: DocumentRepository) {}

  isUploading(documentId: string): boolean {
    return this.live.has(documentId);
  }

  /**
   * ⋮ → Cancel upload on an `uploading` tile (issue #16): aborts the live
   * Storage task — its `result` rejects `storage/canceled` and the pipeline
   * scrubs metadata plus partial bytes. No-op when nothing is in flight.
   */
  cancel(documentId: string): void {
    this.live.get(documentId)?.cancel();
  }

  /** The session's File for a `failed` Document, or `null` (Remove only). */
  fileFor(documentId: string): File | null {
    return this.heldFiles.get(documentId) ?? null;
  }

  async upload(file: File, options: UploadOptions = {}): Promise<UploadHandle> {
    validateDocumentFile(file);
    const record = await this.documents.create({
      title: titleFromFilename(file.name),
      originalFilename: file.name,
      sizeBytes: file.size,
      folderId: options.folderId ?? null,
    });
    return this.run(record.id, file, options);
  }

  /**
   * Re-sends bytes under the same `documentId` (issue #16): the ⋮ Retry
   * upload path while the session holds the File, and drop-to-retry after a
   * reload. Callers offer it on `failed` tiles only — the menu contract is
   * the guard; the metadata (title, `sizeBytes`) stays from the original
   * selection.
   */
  async retryUpload(
    documentId: string,
    file: File,
    options: UploadOptions = {},
  ): Promise<UploadHandle> {
    validateDocumentFile(file);
    await this.documents.setStatus(documentId, 'uploading');
    return this.run(documentId, file, options);
  }

  /**
   * Marks `deleting`, then tears down bytes → Extraction → metadata. A
   * failure leaves the status `deleting` — calling again (or startup
   * reconciliation) re-runs the teardown to completion.
   */
  async delete(documentId: string): Promise<void> {
    try {
      await this.documents.setStatus(documentId, 'deleting');
    } catch (err) {
      if (!isNotFoundError(err)) throw err;
      return; // Metadata already gone — a prior teardown finished the stages.
    }
    await this.documents.delete(documentId);
    this.heldFiles.delete(documentId);
  }

  /**
   * Runs at Host load over the listed library: orphaned `uploading` (no live
   * task in this session) becomes `failed`; `deleting` re-runs to completion.
   */
  async reconcile(documents: DocumentRecord[]): Promise<void> {
    for (const doc of documents) {
      if (doc.status === 'uploading' && !this.isUploading(doc.id)) {
        await this.documents.setStatus(doc.id, 'failed');
      } else if (doc.status === 'deleting') {
        await this.delete(doc.id);
      }
    }
  }

  private run(documentId: string, file: File, options: UploadOptions): UploadHandle {
    this.heldFiles.set(documentId, file);
    const task = this.documents.uploadBytes(
      documentId,
      file,
      (bytesTransferred, totalBytes) =>
        options.onProgress?.(documentId, totalBytes > 0 ? bytesTransferred / totalBytes : 1),
    );
    this.live.set(documentId, task);
    return {
      documentId,
      completion: task.result.then(
        () => this.markReady(documentId),
        (err: unknown) => this.recover(documentId, err),
      ),
      cancel: () => task.cancel(),
    };
  }

  private async markReady(documentId: string): Promise<void> {
    this.live.delete(documentId);
    this.heldFiles.delete(documentId);
    await this.documents.setStatus(documentId, 'ready');
  }

  private async recover(documentId: string, err: unknown): Promise<never> {
    this.live.delete(documentId);
    if (isStorageError(err, 'canceled')) {
      // Cancel (issue #16): the Document never existed — scrub metadata and
      // partial bytes.
      this.heldFiles.delete(documentId);
      await this.documents.delete(documentId);
      throw new UploadCancelledError(documentId);
    }
    // Failed: metadata is retained for retry (Retry upload, drop-to-retry).
    await this.documents.setStatus(documentId, 'failed');
    throw err;
  }
}

/** The initial `title`: the filename without its `.pdf` extension. */
function titleFromFilename(filename: string): string {
  return filename.replace(/\.pdf$/i, '');
}

function isNotFoundError(err: unknown): boolean {
  return (err as { code?: string }).code === 'not-found';
}
