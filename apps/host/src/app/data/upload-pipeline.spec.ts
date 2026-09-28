import { describe, expect, it, vi } from 'vitest';
import type {
  DocumentRecord,
  DocumentStatus,
  ExtractionFailure,
  NewDocument,
} from './document';
import type { DocumentRepository, DocumentUpload } from './document-repository';
import { UploadCancelledError, UploadPipeline } from './upload-pipeline';

/**
 * In-memory DocumentRepository double: records the machine's observable
 * side-effect order (statuses, bytes, teardown) so the pipeline's orchestration
 * can be tested without Firebase. The real Firebase behavior is covered by
 * the integration specs.
 */
class FakeDocumentRepository implements DocumentRepository {
  readonly records = new Map<string, DocumentRecord>();
  readonly calls: string[] = [];
  /** Rejects the next uploadBytes with this error. */
  nextUploadFailure: Error | null = null;
  /** Parks uploads until `releaseGated()` — for concurrency and cancel tests. */
  gated = false;
  /** Rejects the next delete once — a mid-teardown failure. */
  failNextDelete = false;

  private seq = 0;
  private readonly pending = new Map<string, (cancelled: boolean) => void>();

  async list(): Promise<DocumentRecord[]> {
    return [...this.records.values()];
  }

  watch(): () => void {
    return () => undefined;
  }

  async create(input: NewDocument): Promise<DocumentRecord> {
    const id = `doc-${++this.seq}`;
    const record: DocumentRecord = {
      id,
      ownerId: 'owner',
      title: input.title,
      originalFilename: input.originalFilename,
      contentType: 'application/pdf',
      sizeBytes: input.sizeBytes,
      storagePath: `users/owner/documents/${id}.pdf`,
      status: 'uploading',
      folderId: input.folderId,
      createdAt: { seconds: 1, nanoseconds: 0 },
      updatedAt: { seconds: 1, nanoseconds: 0 },
    };
    this.records.set(id, record);
    this.calls.push(`create:${id}`);
    return { ...record };
  }

  async getBytes(): Promise<ArrayBuffer> {
    return new Uint8Array([1, 2, 3]).buffer;
  }

  async setStatus(documentId: string, status: DocumentStatus): Promise<void> {
    this.calls.push(`status:${documentId}:${status}`);
    const record = this.records.get(documentId);
    if (!record) throw notFound();
    this.records.set(documentId, { ...record, status });
  }

  async setExtractionFailure(
    documentId: string,
    failure: Omit<ExtractionFailure, 'failedAt'> | null,
  ): Promise<void> {
    this.calls.push(`extraction-failure:${documentId}`);
    const record = this.records.get(documentId);
    if (!record) throw notFound();
    this.records.set(documentId, {
      ...record,
      extractionFailure:
        failure === null ? null : { ...failure, failedAt: { seconds: 1, nanoseconds: 0 } },
    });
  }

  async rename(documentId: string, title: string): Promise<void> {
    const record = this.records.get(documentId);
    if (!record) throw notFound();
    this.records.set(documentId, { ...record, title });
  }

  async setFolder(documentId: string, folderId: string | null): Promise<void> {
    const record = this.records.get(documentId);
    if (!record) throw notFound();
    this.records.set(documentId, { ...record, folderId });
  }

  uploadBytes(
    documentId: string,
    _data: Blob,
    onProgress?: (bytesTransferred: number, totalBytes: number) => void,
  ): DocumentUpload {
    this.calls.push(`bytes:${documentId}`);
    if (this.nextUploadFailure) {
      const err = this.nextUploadFailure;
      this.nextUploadFailure = null;
      return { cancel: () => undefined, result: Promise.reject(err) };
    }
    let settled = false;
    let settle!: (cancelled: boolean) => void;
    const result = new Promise<void>((resolve, reject) => {
      settle = (cancelled: boolean) => {
        if (settled) return;
        settled = true;
        this.pending.delete(documentId);
        if (cancelled) {
          reject(cancelError());
        } else {
          onProgress?.(4, 4);
          resolve();
        }
      };
    });
    if (this.gated) this.pending.set(documentId, settle);
    else settle(false);
    return {
      cancel: () => {
        this.calls.push(`cancel:${documentId}`);
        settle(true);
      },
      result,
    };
  }

  releaseGated(): void {
    for (const settle of [...this.pending.values()]) settle(false);
  }

  async delete(documentId: string): Promise<void> {
    this.calls.push(`delete:${documentId}`);
    const record = this.records.get(documentId);
    if (!record) throw notFound();
    if (this.failNextDelete) {
      this.failNextDelete = false;
      throw new Error('delete failed');
    }
    this.records.delete(documentId);
  }
}

function notFound(): Error {
  return Object.assign(new Error('not found'), { code: 'not-found' });
}

function cancelError(): Error {
  return Object.assign(new Error('canceled'), { code: 'storage/canceled' });
}

function pdfFile(name = 'rechnung.pdf'): File {
  return new File([new Uint8Array(4)], name, { type: 'application/pdf' });
}

async function uploadFailedDocument(
  documents: FakeDocumentRepository,
): Promise<{ pipeline: UploadPipeline; documentId: string }> {
  documents.nextUploadFailure = new Error('storage down');
  const pipeline = new UploadPipeline(documents);
  const handle = await pipeline.upload(pdfFile());
  await expect(handle.completion).rejects.toThrow('storage down');
  return { pipeline, documentId: handle.documentId };
}

describe('UploadPipeline (issue #27 state machine)', () => {
  it('runs the metadata-first happy path: uploading → bytes → ready', async () => {
    const documents = new FakeDocumentRepository();
    const pipeline = new UploadPipeline(documents);

    const handle = await pipeline.upload(pdfFile('mietvertrag.pdf'), { folderId: 'wohnung' });
    await handle.completion;

    expect(documents.records.get(handle.documentId)).toMatchObject({
      title: 'mietvertrag',
      folderId: 'wohnung',
      status: 'ready',
    });
    expect(documents.calls).toEqual([
      `create:${handle.documentId}`,
      `bytes:${handle.documentId}`,
      `status:${handle.documentId}:ready`,
    ]);
  });

  it('rejects non-PDF input loudly and writes no metadata', async () => {
    const documents = new FakeDocumentRepository();
    const pipeline = new UploadPipeline(documents);

    await expect(
      pipeline.upload(new File([new Uint8Array(4)], 'bild.png', { type: 'image/png' })),
    ).rejects.toThrow('Only PDF files are supported');
    expect(documents.records.size).toBe(0);
  });

  it('reports per-upload progress as a 0–1 fraction', async () => {
    const documents = new FakeDocumentRepository();
    const pipeline = new UploadPipeline(documents);
    const onProgress = vi.fn();

    const handle = await pipeline.upload(pdfFile(), { onProgress });
    await handle.completion;

    expect(onProgress).toHaveBeenCalledWith(handle.documentId, 1);
  });

  it('runs uploads concurrently, each with its own progress', async () => {
    const documents = new FakeDocumentRepository();
    documents.gated = true;
    const pipeline = new UploadPipeline(documents);
    const progressA = vi.fn();
    const progressB = vi.fn();

    const a = await pipeline.upload(pdfFile('a.pdf'), { onProgress: progressA });
    const b = await pipeline.upload(pdfFile('b.pdf'), { onProgress: progressB });
    // Both tasks are in flight before either is released.
    expect(documents.calls).toContain(`bytes:${a.documentId}`);
    expect(documents.calls).toContain(`bytes:${b.documentId}`);

    documents.releaseGated();
    await Promise.all([a.completion, b.completion]);

    expect(documents.records.get(a.documentId)?.status).toBe('ready');
    expect(documents.records.get(b.documentId)?.status).toBe('ready');
    expect(progressA).toHaveBeenCalledWith(a.documentId, 1);
    expect(progressB).toHaveBeenCalledWith(b.documentId, 1);
  });

  it('marks a failed upload failed — metadata retained for retry', async () => {
    const documents = new FakeDocumentRepository();
    const pipeline = new UploadPipeline(documents);
    documents.nextUploadFailure = new Error('storage down');

    const handle = await pipeline.upload(pdfFile());
    await expect(handle.completion).rejects.toThrow('storage down');

    expect(documents.records.get(handle.documentId)?.status).toBe('failed');
  });

  it('cancels the task and deletes metadata plus partial bytes', async () => {
    const documents = new FakeDocumentRepository();
    documents.gated = true;
    const pipeline = new UploadPipeline(documents);

    const handle = await pipeline.upload(pdfFile());
    handle.cancel();
    await expect(handle.completion).rejects.toThrow(UploadCancelledError);

    expect(documents.calls).toContain(`delete:${handle.documentId}`);
    expect(documents.records.has(handle.documentId)).toBe(false);
  });

  it('retries a failed upload under the same documentId', async () => {
    const documents = new FakeDocumentRepository();
    const { pipeline, documentId } = await uploadFailedDocument(documents);

    const retried = await pipeline.retryUpload(documentId, pdfFile());
    expect(retried.documentId).toBe(documentId);
    await retried.completion;

    expect(documents.calls).toContain(`status:${documentId}:uploading`);
    expect(documents.records.get(documentId)?.status).toBe('ready');
  });

  it('holds the File for retry while a Document sits failed; releases it once ready', async () => {
    const documents = new FakeDocumentRepository();
    const { pipeline, documentId } = await uploadFailedDocument(documents);
    const held = pipeline.fileFor(documentId);
    expect(held?.name).toBe('rechnung.pdf');

    const retried = await pipeline.retryUpload(documentId, held!);
    await retried.completion;
    expect(pipeline.fileFor(documentId)).toBeNull();
  });

  it('releases the File when the upload is cancelled or the Document deleted', async () => {
    const documents = new FakeDocumentRepository();
    documents.gated = true;
    const pipeline = new UploadPipeline(documents);
    const handle = await pipeline.upload(pdfFile());
    handle.cancel();
    await expect(handle.completion).rejects.toThrow(UploadCancelledError);
    expect(pipeline.fileFor(handle.documentId)).toBeNull();

    documents.nextUploadFailure = new Error('storage down');
    const failed = await pipeline.upload(pdfFile());
    await expect(failed.completion).rejects.toThrow('storage down');
    expect(pipeline.fileFor(failed.documentId)).not.toBeNull();
    await pipeline.delete(failed.documentId);
    expect(pipeline.fileFor(failed.documentId)).toBeNull();
  });

  it('validates the retried file through the same input boundary', async () => {
    const documents = new FakeDocumentRepository();
    const { pipeline, documentId } = await uploadFailedDocument(documents);

    await expect(
      pipeline.retryUpload(documentId, new File([new Uint8Array(4)], 'x.png', { type: 'image/png' })),
    ).rejects.toThrow('Only PDF files are supported');
    expect(documents.records.get(documentId)?.status).toBe('failed');
  });

  it('deletes: marks deleting, tears down; a failed delete stays deleting and is retryable', async () => {
    const documents = new FakeDocumentRepository();
    const pipeline = new UploadPipeline(documents);
    const handle = await pipeline.upload(pdfFile());
    await handle.completion;

    await pipeline.delete(handle.documentId);
    expect(documents.calls).toContain(`status:${handle.documentId}:deleting`);
    expect(documents.records.has(handle.documentId)).toBe(false);

    const second = await pipeline.upload(pdfFile('zweite.pdf'));
    await second.completion;
    documents.failNextDelete = true;
    await expect(pipeline.delete(second.documentId)).rejects.toThrow('delete failed');
    expect(documents.records.get(second.documentId)?.status).toBe('deleting');

    await pipeline.delete(second.documentId);
    expect(documents.records.has(second.documentId)).toBe(false);
  });

  it('reconciles on startup: orphaned uploading → failed, deleting → torn down', async () => {
    const documents = new FakeDocumentRepository();
    const pipeline = new UploadPipeline(documents);
    const orphan = await seed(documents, 'uploading');
    const doomed = await seed(documents, 'deleting');
    documents.gated = true;
    const live = await pipeline.upload(pdfFile('live.pdf'));

    await pipeline.reconcile([...documents.records.values()]);

    expect(documents.records.get(orphan)?.status).toBe('failed');
    expect(documents.records.has(doomed)).toBe(false);
    // A live task is never marked failed by reconciliation.
    expect(documents.records.get(live.documentId)?.status).toBe('uploading');

    documents.releaseGated();
    await live.completion;
  });
});

async function seed(documents: FakeDocumentRepository, status: DocumentStatus) {
  const record = await documents.create({
    title: 'seed',
    originalFilename: 'seed.pdf',
    sizeBytes: 4,
    folderId: null,
  });
  await documents.setStatus(record.id, status);
  return record.id;
}
