import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { ExtractionJobs } from '../bus/extraction-jobs';
import type { DocumentRecord, DocumentStatus, NewDocument } from '../data/document';
import type { DocumentRepository, DocumentUpload } from '../data/document-repository';
import { DOCUMENT_REPOSITORY } from '../data/providers';
import { UploadPipeline } from '../data/upload-pipeline';
import { OpenDocument } from '../open-document';
import { ToastService } from '../toasts/toast.service';
import { LibraryStore } from './library.store';

/**
 * Snapshot-emitting repository double: like Firestore, every mutation pushes
 * the full list to `watch` listeners, so the store's live-update behavior is
 * exercised without the emulator. Storage tasks gate on `releaseGated()`.
 */
class FakeDocumentRepository implements DocumentRepository {
  readonly records = new Map<string, DocumentRecord>();
  readonly calls: string[] = [];
  nextUploadFailure: Error | null = null;
  /** Parks upload tasks until `releaseGated()`; they report half progress. */
  gated = false;
  failNextDelete = false;

  private seq = 0;
  private readonly pending = new Map<string, (cancelled: boolean) => void>();
  private readonly listeners = new Set<(documents: DocumentRecord[]) => void>();

  private emit(): void {
    const documents = [...this.records.values()];
    for (const listener of this.listeners) listener(documents);
  }

  watch(listener: (documents: DocumentRecord[]) => void): () => void {
    this.listeners.add(listener);
    listener([...this.records.values()]);
    return () => this.listeners.delete(listener);
  }

  async list(): Promise<DocumentRecord[]> {
    return [...this.records.values()];
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
    this.emit();
    return { ...record };
  }

  async setStatus(documentId: string, status: DocumentStatus): Promise<void> {
    this.calls.push(`status:${documentId}:${status}`);
    const record = this.records.get(documentId);
    if (!record) throw notFound();
    this.records.set(documentId, { ...record, status });
    this.emit();
  }

  async rename(documentId: string, title: string): Promise<void> {
    this.calls.push(`rename:${documentId}:${title}`);
    const record = this.records.get(documentId);
    if (!record) throw notFound();
    this.records.set(documentId, { ...record, title });
    this.emit();
  }

  async setFolder(documentId: string, folderId: string | null): Promise<void> {
    this.calls.push(`folder:${documentId}:${folderId}`);
    const record = this.records.get(documentId);
    if (!record) throw notFound();
    this.records.set(documentId, { ...record, folderId });
    this.emit();
  }

  async getBytes(): Promise<ArrayBuffer> {
    return new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer;
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
    let settle!: (cancelled: boolean) => void;
    const result = new Promise<void>((resolve, reject) => {
      settle = (cancelled: boolean) => {
        this.pending.delete(documentId);
        if (cancelled) reject(cancelError());
        else {
          onProgress?.(4, 4);
          resolve();
        }
      };
    });
    if (this.gated) {
      this.pending.set(documentId, settle);
      onProgress?.(2, 4); // mid-flight snapshot for progress assertions
    } else {
      queueMicrotask(() => settle(false));
    }
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
    this.emit();
  }

  async seed(status: DocumentStatus): Promise<string> {
    const record = await this.create({
      title: 'seed',
      originalFilename: 'seed.pdf',
      sizeBytes: 4,
      folderId: null,
    });
    this.records.set(record.id, { ...record, status });
    this.emit();
    return record.id;
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

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

function setup() {
  const repository = new FakeDocumentRepository();
  const jobs = { cancelJobsFor: vi.fn() };
  TestBed.configureTestingModule({
    providers: [
      { provide: DOCUMENT_REPOSITORY, useValue: repository },
      { provide: UploadPipeline, useFactory: () => new UploadPipeline(repository) },
      { provide: ExtractionJobs, useValue: jobs },
      LibraryStore,
    ],
  });
  return {
    repository,
    jobs,
    store: TestBed.inject(LibraryStore),
    toasts: TestBed.inject(ToastService),
    open: TestBed.inject(OpenDocument),
  };
}

/** Waits for the store's documents signal to satisfy `predicate`. */
async function until(store: LibraryStore, predicate: (docs: DocumentRecord[]) => boolean) {
  for (let i = 0; i < 100; i++) {
    const docs = store.documents();
    if (docs && predicate(docs)) return docs;
    await flush();
  }
  throw new Error('store did not reach expected state');
}

describe('LibraryStore', () => {
  it('reflects the live library from the repository watch feed', async () => {
    const { store, repository } = setup();
    expect(store.documents()).toEqual([]);

    await repository.create({
      title: 'mietvertrag',
      originalFilename: 'mietvertrag.pdf',
      sizeBytes: 4,
      folderId: null,
    });
    expect(store.documents()![0]!.title).toBe('mietvertrag');
  });

  it('uploads a PDF: tile appears at uploading, progress lands, ready + toast', async () => {
    const { store, repository, toasts } = setup();
    repository.gated = true;

    store.uploadFiles([pdfFile('rechnung.pdf')]);
    const docs = await until(store, (d) => d.some((doc) => doc.status === 'uploading'));
    const documentId = docs[0]!.id;
    await until(store, () => store.progress().get(documentId) === 0.5);

    repository.releaseGated();
    await until(store, (d) => d[0]?.status === 'ready');

    expect(store.progress().has(documentId)).toBe(false);
    expect(toasts.toasts().map((t) => t.title)).toContain('Uploaded rechnung.pdf');
  });

  it('rejects a non-PDF with the decided notification and writes no metadata', async () => {
    const { store, repository, toasts } = setup();
    store.uploadFiles([new File([new Uint8Array(4)], 'bild.png', { type: 'image/png' })]);
    await flush();

    expect(repository.records.size).toBe(0);
    expect(toasts.toasts()[0]).toMatchObject({
      tone: 'error',
      title: 'Only PDF files are supported',
      body: 'bild.png',
    });
  });

  it('cancel upload aborts the task and the Document disappears silently', async () => {
    const { store, repository, toasts } = setup();
    repository.gated = true;
    store.uploadFiles([pdfFile()]);
    const [doc] = await until(store, (d) => d.length === 1);

    store.cancelUpload(doc!.id);
    await until(store, (d) => d.length === 0);
    expect(repository.calls).toContain(`delete:${doc!.id}`);
    expect(toasts.toasts()).toHaveLength(0);
  });

  it('failed upload keeps the tile; retry via the held File reaches ready', async () => {
    const { store, repository } = setup();
    repository.nextUploadFailure = new Error('storage down');
    store.uploadFiles([pdfFile()]);
    const [doc] = await until(store, (d) => d[0]?.status === 'failed');

    expect(store.canRetryUpload(doc!.id)).toBe(true);
    store.retryUpload(doc!.id);
    await until(store, (d) => d[0]?.status === 'ready');
  });

  it('drop-to-retry re-sends dropped bytes under the same documentId', async () => {
    const { store, repository } = setup();
    repository.nextUploadFailure = new Error('storage down');
    store.uploadFiles([pdfFile()]);
    const [doc] = await until(store, (d) => d[0]?.status === 'failed');

    store.retryWithFile(doc!.id, pdfFile('scan-0412.pdf'));
    await until(store, (d) => d[0]?.status === 'ready');
    expect(repository.records.get(doc!.id)?.originalFilename).toBe('rechnung.pdf');
  });

  it('drop-to-retry with a non-PDF is rejected without touching the Document', async () => {
    const { store, repository, toasts } = setup();
    repository.nextUploadFailure = new Error('storage down');
    store.uploadFiles([pdfFile()]);
    const [doc] = await until(store, (d) => d[0]?.status === 'failed');

    store.retryWithFile(doc!.id, new File([new Uint8Array(4)], 'x.png', { type: 'image/png' }));
    await flush();
    expect(toasts.toasts().map((t) => t.title)).toContain('Only PDF files are supported');
    expect(store.documents()![0]!.status).toBe('failed');
  });

  it('remove deletes a failed Document: metadata and partial bytes gone', async () => {
    const { store, repository } = setup();
    repository.nextUploadFailure = new Error('storage down');
    store.uploadFiles([pdfFile()]);
    const [doc] = await until(store, (d) => d[0]?.status === 'failed');

    await store.removeFailed(doc!.id);
    expect(repository.records.has(doc!.id)).toBe(false);
    expect(store.canRetryUpload(doc!.id)).toBe(false);
  });

  it('rename trims and persists title only; blank titles are refused', async () => {
    const { store, repository } = setup();
    const id = await repository.seed('ready');
    await until(store, (d) => d.length === 1);

    await store.rename(id, '   ');
    expect(repository.records.get(id)?.title).toBe('seed');

    await store.rename(id, '  Mietvertrag 2024  ');
    const doc = repository.records.get(id);
    expect(doc?.title).toBe('Mietvertrag 2024');
    expect(doc?.originalFilename).toBe('seed.pdf');
  });

  it('download fetches bytes and triggers a blob download under the original filename', async () => {
    const { store, repository } = setup();
    const id = await repository.seed('ready');
    Object.assign(URL, {
      createObjectURL: vi.fn(() => 'blob:fake'),
      revokeObjectURL: vi.fn(),
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await store.download(id);

    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    // The URL revoke is deferred so the save can't be cancelled.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake');
  });

  it('delete confirm cancels jobs, tears down, navigates back, and toasts', async () => {
    const { store, repository, jobs, toasts, open } = setup();
    const id = await repository.seed('ready');
    store.open(id);
    expect(open.id()).toBe(id);

    await store.confirmDelete(id);

    expect(jobs.cancelJobsFor).toHaveBeenCalledWith(id);
    expect(open.id()).toBeNull();
    expect(repository.records.has(id)).toBe(false);
    expect(toasts.toasts().map((t) => t.title)).toContain('Deleted seed');
  });

  it('a failed delete stays deleting and offers retry; retry completes it', async () => {
    const { store, repository, toasts } = setup();
    const id = await repository.seed('ready');
    await until(store, (d) => d.length === 1);
    repository.failNextDelete = true;

    await store.confirmDelete(id);
    expect(repository.records.get(id)?.status).toBe('deleting');
    expect(store.failedDeletes().has(id)).toBe(true);
    expect(toasts.toasts()[0]?.tone).toBe('error');

    await store.retryDelete(id);
    expect(repository.records.has(id)).toBe(false);
    expect(store.failedDeletes().has(id)).toBe(false);
  });

  it('opens only ready Documents; a deleted open Document navigates back', async () => {
    const { store, repository, open } = setup();
    const readyId = await repository.seed('ready');
    const uploadingId = await repository.seed('uploading');
    await until(store, (d) => d.length === 2);

    store.open(uploadingId);
    expect(open.id()).toBeNull();
    store.open(readyId);
    expect(open.id()).toBe(readyId);

    await repository.delete(readyId);
    await until(store, (d) => d.length === 1);
    expect(open.id()).toBeNull();
  });

  it('startup reconciliation: orphaned uploading → failed, deleting re-runs', async () => {
    const repository = new FakeDocumentRepository();
    const orphan = await repository.seed('uploading');
    const doomed = await repository.seed('deleting');
    const { store } = setupLate(repository);

    await until(store, (d) => d.length === 1);
    expect(repository.records.get(orphan)?.status).toBe('failed');
    expect(repository.records.has(doomed)).toBe(false);
  });

  it('a stuck deleting Document after reconciliation offers Retry delete', async () => {
    const repository = new FakeDocumentRepository();
    const stuck = await repository.seed('deleting');
    repository.failNextDelete = true;
    const { store } = setupLate(repository);

    await until(store, () => store.failedDeletes().has(stuck));
    expect(repository.records.get(stuck)?.status).toBe('deleting');
  });
});

/** A store bound to a pre-seeded repository — for startup-state tests. */
function setupLate(repository: FakeDocumentRepository) {
  const jobs = { cancelJobsFor: vi.fn() };
  TestBed.configureTestingModule({
    providers: [
      { provide: DOCUMENT_REPOSITORY, useValue: repository },
      { provide: UploadPipeline, useFactory: () => new UploadPipeline(repository) },
      { provide: ExtractionJobs, useValue: jobs },
      LibraryStore,
    ],
  });
  return {
    repository,
    jobs,
    store: TestBed.inject(LibraryStore),
    toasts: TestBed.inject(ToastService),
    open: TestBed.inject(OpenDocument),
  };
}
