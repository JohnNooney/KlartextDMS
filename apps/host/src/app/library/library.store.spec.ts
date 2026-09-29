import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { NEVER } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { HostBus } from '../bus/host-bus';
import type {
  DocumentRecord,
  DocumentStatus,
  ExtractionFailure,
  NewDocument,
} from '../data/document';
import type { DocumentRepository, DocumentUpload } from '../data/document-repository';
import type { FolderRecord } from '../data/folder';
import type { FolderPatch, FolderRepository, NewFolder } from '../data/folder-repository';
import { DOCUMENT_REPOSITORY, FOLDER_REPOSITORY } from '../data/providers';
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
  /** Parks `create` after its metadata lands (and emits) until `releaseCreate()`. */
  gateCreate = false;
  private createGate: (() => void) | null = null;

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
    if (this.gateCreate) await new Promise<void>((resolve) => (this.createGate = resolve));
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

  releaseCreate(): void {
    this.createGate?.();
    this.createGate = null;
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

/** Snapshot-emitting Folder repository double — every mutation pushes the full list. */
class FakeFolderRepository implements FolderRepository {
  readonly records = new Map<string, FolderRecord>();
  readonly calls: string[] = [];
  /** Folder ids whose `delete` rejects once. */
  failDeleteOf = new Set<string>();

  private seq = 0;
  private readonly listeners = new Set<(folders: FolderRecord[]) => void>();

  private emit(): void {
    const folders = [...this.records.values()];
    for (const listener of this.listeners) listener(folders);
  }

  watch(listener: (folders: FolderRecord[]) => void): () => void {
    this.listeners.add(listener);
    listener([...this.records.values()]);
    return () => this.listeners.delete(listener);
  }

  async list(): Promise<FolderRecord[]> {
    return [...this.records.values()];
  }

  async create(input: NewFolder): Promise<FolderRecord> {
    const id = `folder-${++this.seq}`;
    const record: FolderRecord = {
      id,
      name: input.name,
      parentId: input.parentId,
      status: 'ready',
      ...(input.description ? { description: input.description } : {}),
      ...(input.keywords ? { keywords: input.keywords } : {}),
      createdAt: { seconds: 1, nanoseconds: 0 },
      updatedAt: { seconds: 1, nanoseconds: 0 },
    };
    this.records.set(id, record);
    this.calls.push(`create:${id}`);
    this.emit();
    return record;
  }

  async update(folderId: string, patch: FolderPatch): Promise<void> {
    this.calls.push(`update:${folderId}:${JSON.stringify(patch)}`);
    const record = this.records.get(folderId);
    if (!record) throw notFound();
    this.records.set(folderId, { ...record, ...patch });
    this.emit();
  }

  async delete(folderId: string): Promise<void> {
    this.calls.push(`delete:${folderId}`);
    if (this.failDeleteOf.delete(folderId)) throw new Error('folder delete failed');
    this.records.delete(folderId);
    this.emit();
  }

  /** Seeds a Folder synchronously-ish (before the store is created). */
  async seed(name: string, parentId: string | null = null, status: 'ready' | 'deleting' = 'ready') {
    const record = await this.create({ name, parentId });
    if (status !== 'ready') await this.update(record.id, { status });
    this.calls.length = 0;
    return record.id;
  }
}

/**
 * OpenDocument navigates on open/close (issue #29); the Router is a pure
 * recording stub here — route↔signal sync is covered in open-document.spec.
 */
const fakeRouter = {
  events: NEVER,
  routerState: { snapshot: { root: { firstChild: null } } },
  navigate: vi.fn(async () => true),
};

function setup() {
  const repository = new FakeDocumentRepository();
  const folderRepository = new FakeFolderRepository();
  const jobs = { cancelJobsFor: vi.fn() };
  fakeRouter.navigate.mockClear();
  TestBed.configureTestingModule({
    providers: [
      { provide: DOCUMENT_REPOSITORY, useValue: repository },
      { provide: FOLDER_REPOSITORY, useValue: folderRepository },
      { provide: UploadPipeline, useFactory: () => new UploadPipeline(repository) },
      { provide: HostBus, useValue: jobs },
      { provide: Router, useValue: fakeRouter },
      LibraryStore,
    ],
  });
  return {
    repository,
    folderRepository,
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
    expect(open.docId()).toBe(id);

    await store.confirmDelete(id);

    expect(jobs.cancelJobsFor).toHaveBeenCalledWith(id);
    expect(open.docId()).toBeNull();
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
    expect(open.docId()).toBeNull();
    store.open(readyId);
    expect(open.docId()).toBe(readyId);

    await repository.delete(readyId);
    await until(store, (d) => d.length === 1);
    expect(open.docId()).toBeNull();
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

  describe('Folders (issue #33)', () => {
    async function untilFolders(store: LibraryStore, predicate: (f: FolderRecord[]) => boolean) {
      for (let i = 0; i < 100; i++) {
        const folders = store.folders();
        if (folders && predicate(folders)) return folders;
        await flush();
      }
      throw new Error('store did not reach expected folder state');
    }

    it('creates a Folder under the browsed Folder with optional annotations', async () => {
      const { store, folderRepository, open } = setup();
      const parent = await folderRepository.seed('Wohnung');
      await untilFolders(store, (f) => f.length === 1);
      open.folderId.set(parent);

      const created = await store.createFolder({
        name: '  Miete ',
        description: 'Rent',
        keywords: ['miete'],
      });

      expect(created).toBe(true);
      const record = [...folderRepository.records.values()].find((f) => f.name === 'Miete');
      expect(record).toMatchObject({ parentId: parent, description: 'Rent', keywords: ['miete'] });
    });

    it('refuses a sibling name that exists case-insensitively, but allows it elsewhere', async () => {
      const { store, folderRepository } = setup();
      const wohnung = await folderRepository.seed('Wohnung');
      await folderRepository.seed('Steuer', wohnung);
      await untilFolders(store, (f) => f.length === 2);

      expect(store.nameTaken(null, ' WOHNUNG ')).toBe(true);
      expect(await store.createFolder({ name: 'wohnung' })).toBe(false);
      expect(folderRepository.calls).toEqual([]);
      expect(await store.createFolder({ name: 'Steuer' })).toBe(true);
    });

    it('renames trimmed, refusing blank and duplicate names', async () => {
      const { store, folderRepository } = setup();
      const a = await folderRepository.seed('Alpha');
      await folderRepository.seed('Beta');
      await untilFolders(store, (f) => f.length === 2);

      expect(await store.renameFolder(a, '  ')).toBe(false);
      expect(await store.renameFolder(a, 'beta')).toBe(false);
      expect(await store.renameFolder(a, ' Alpha ')).toBe(true);
      expect(await store.renameFolder(a, 'Gamma')).toBe(true);
      expect(folderRepository.records.get(a)?.name).toBe('Gamma');
    });

    it('moves a Folder but rejects itself and descendants as targets', async () => {
      const { store, folderRepository, toasts } = setup();
      const a = await folderRepository.seed('A');
      const b = await folderRepository.seed('B', a);
      const c = await folderRepository.seed('C');
      await untilFolders(store, (f) => f.length === 3);

      expect(await store.moveFolder(a, b)).toBe(false);
      expect(await store.moveFolder(a, a)).toBe(false);
      expect(folderRepository.records.get(a)?.parentId).toBeNull();
      expect(toasts.toasts()[0]).toMatchObject({ tone: 'error', title: 'Move failed' });

      expect(await store.moveFolder(c, b)).toBe(true);
      expect(folderRepository.records.get(c)?.parentId).toBe(b);
    });

    it('rejects a move that collides with a sibling name at the target', async () => {
      const { store, folderRepository } = setup();
      const a = await folderRepository.seed('A');
      await folderRepository.seed('Steuer', a);
      const other = await folderRepository.seed('steuer');
      await untilFolders(store, (f) => f.length === 3);

      expect(await store.moveFolder(other, a)).toBe(false);
      expect(folderRepository.records.get(other)?.parentId).toBeNull();
    });

    async function seedDoc(repository: FakeDocumentRepository, folderId: string | null) {
      const record = await repository.create({
        title: `doc-in-${folderId}`,
        originalFilename: 'x.pdf',
        sizeBytes: 4,
        folderId,
      });
      await repository.setStatus(record.id, 'ready');
      return record.id;
    }

    /** a → b → c, with one Document in a and one in c. */
    async function seedTree(repository: FakeDocumentRepository, folders: FakeFolderRepository) {
      const a = await folders.seed('A');
      const b = await folders.seed('B', a);
      const c = await folders.seed('C', b);
      const docA = await seedDoc(repository, a);
      const docC = await seedDoc(repository, c);
      return { a, b, c, docA, docC };
    }

    it('recursive delete cancels jobs, tears Documents down, then Folders deepest-first', async () => {
      const { store, repository, folderRepository, jobs, toasts } = setup();
      const { a, b, c, docA, docC } = await seedTree(repository, folderRepository);
      await untilFolders(store, (f) => f.length === 3);
      const docsLeftWhenFolderDeleted: number[] = [];
      const realDelete = folderRepository.delete.bind(folderRepository);
      folderRepository.delete = async (id) => {
        docsLeftWhenFolderDeleted.push(repository.records.size);
        await realDelete(id);
      };

      await store.deleteFolder(a);

      expect(jobs.cancelJobsFor).toHaveBeenCalledWith(docA);
      expect(jobs.cancelJobsFor).toHaveBeenCalledWith(docC);
      expect(repository.records.size).toBe(0);
      expect(folderRepository.records.size).toBe(0);
      expect(folderRepository.calls.filter((call) => call.startsWith('delete:'))).toEqual([
        `delete:${c}`,
        `delete:${b}`,
        `delete:${a}`,
      ]);
      expect(folderRepository.calls[0]).toBe(`update:${a}:{"status":"deleting"}`);
      expect(docsLeftWhenFolderDeleted).toEqual([0, 0, 0]);
      expect(toasts.toasts().map((t) => t.title)).toContain('Deleted A');
    });

    it('navigates back with a toast when the open Document is inside the deleted tree', async () => {
      const { store, repository, folderRepository, open } = setup();
      const { a, docC } = await seedTree(repository, folderRepository);
      const parent = await folderRepository.seed('Parent');
      await folderRepository.update(a, { parentId: parent });
      await until(store, (d) => d.length === 2);
      await untilFolders(store, (f) => f.length === 4);
      store.open(docC);
      expect(open.docId()).toBe(docC);

      await store.deleteFolder(a);

      expect(open.docId()).toBeNull();
      expect(open.folderId()).toBe(parent);
    });

    it('a failed teardown leaves the Folder deleting; retry completes it', async () => {
      const { store, repository, folderRepository, toasts } = setup();
      const { a, docC } = await seedTree(repository, folderRepository);
      await untilFolders(store, (f) => f.length === 3);
      repository.failNextDelete = true;

      await store.deleteFolder(a);

      expect(folderRepository.records.get(a)?.status).toBe('deleting');
      expect(store.failedFolderDeletes().has(a)).toBe(true);
      expect(toasts.toasts().some((t) => t.tone === 'error')).toBe(true);

      await store.retryFolderDelete(a);

      expect(folderRepository.records.size).toBe(0);
      expect(repository.records.has(docC)).toBe(false);
      expect(store.failedFolderDeletes().has(a)).toBe(false);
    });

    it('refuses to file a Document or Folder into a deleting Folder', async () => {
      const { store, repository, folderRepository } = setup();
      const target = await folderRepository.seed('Target', null, 'deleting');
      const other = await folderRepository.seed('Other');
      const docId = await seedDoc(repository, null);
      await untilFolders(store, (f) => f.length === 2);
      await until(store, (d) => d.length === 1);

      await store.move(docId, target);
      await store.dropItem({ kind: 'document', id: docId }, target);
      expect(await store.moveFolder(other, target)).toBe(false);

      expect(repository.records.get(docId)?.folderId).toBeNull();
      expect(folderRepository.records.get(other)?.parentId).toBeNull();
    });

    it('stays put when marking the Folder deleting fails', async () => {
      const { store, repository, folderRepository, open, toasts } = setup();
      const { a } = await seedTree(repository, folderRepository);
      await untilFolders(store, (f) => f.length === 3);
      open.folderId.set(a);
      folderRepository.update = async () => {
        throw new Error('offline');
      };

      await store.deleteFolder(a);

      expect(open.folderId()).toBe(a);
      expect(folderRepository.records.size).toBe(3);
      expect(toasts.toasts()[0]?.tone).toBe('error');
    });

    it('cancels an in-flight upload inside the deleted tree before tearing it down', async () => {
      const { store, repository, folderRepository } = setup();
      const a = await folderRepository.seed('A');
      await untilFolders(store, (f) => f.length === 1);
      repository.gated = true;
      store.uploadFiles([pdfFile()], a);
      await until(store, (d) => d[0]?.status === 'uploading');
      const id = store.documents()![0]!.id;

      await store.deleteFolder(a);
      await flush();

      expect(repository.calls).toContain(`cancel:${id}`);
      expect(repository.records.size).toBe(0);
      expect(folderRepository.records.size).toBe(0);
    });

    it('an upload whose metadata is still landing never sends bytes into a deleted tree', async () => {
      const { store, repository, folderRepository, toasts } = setup();
      const a = await folderRepository.seed('A');
      await untilFolders(store, (f) => f.length === 1);
      repository.gateCreate = true;
      store.uploadFiles([pdfFile()], a);
      await until(store, (d) => d[0]?.status === 'uploading');
      const id = store.documents()![0]!.id;

      await store.deleteFolder(a);
      repository.releaseCreate();
      await flush();

      expect(repository.calls).not.toContain(`bytes:${id}`);
      expect(repository.records.size).toBe(0);
      expect(folderRepository.records.size).toBe(0);
      expect(toasts.toasts().map((t) => t.title)).not.toContain('Upload failed');
    });

    it('leaves a browsed Folder that is deleting or gone for its parent', async () => {
      const { store, folderRepository, open } = setup();
      const a = await folderRepository.seed('A');
      const b = await folderRepository.seed('B', a);
      await untilFolders(store, (f) => f.length === 2);
      open.folderId.set(b);

      await folderRepository.update(b, { status: 'deleting' });
      expect(open.folderId()).toBe(a);

      await folderRepository.delete(a);
      expect(open.folderId()).toBeNull();
    });

    it('startup reconcile runs a nested deleting subtree once, from its top', async () => {
      const repository = new FakeDocumentRepository();
      const folderRepository = new FakeFolderRepository();
      const a = await folderRepository.seed('A', null, 'deleting');
      const b = await folderRepository.seed('B', a, 'deleting');
      await seedDoc(repository, b);

      setupLate(repository, folderRepository);

      for (let i = 0; i < 100 && folderRepository.records.size > 0; i++) await flush();
      expect(folderRepository.records.size).toBe(0);
      expect(folderRepository.calls.filter((c) => c === `delete:${b}`)).toHaveLength(1);
    });

    it('startup reconcile re-runs a Folder left deleting, including its contents', async () => {
      const repository = new FakeDocumentRepository();
      const folderRepository = new FakeFolderRepository();
      const a = await folderRepository.seed('A', null, 'deleting');
      const b = await folderRepository.seed('B', a);
      await seedDoc(repository, b);

      const { store } = setupLate(repository, folderRepository);

      for (let i = 0; i < 100 && folderRepository.records.size > 0; i++) await flush();
      expect(folderRepository.records.size).toBe(0);
      expect(repository.records.size).toBe(0);
      expect(store.failedFolderDeletes().size).toBe(0);
    });

    it('a startup reconcile that still fails offers Retry delete', async () => {
      const repository = new FakeDocumentRepository();
      const folderRepository = new FakeFolderRepository();
      const a = await folderRepository.seed('A', null, 'deleting');
      await seedDoc(repository, a);
      repository.failNextDelete = true;

      const { store } = setupLate(repository, folderRepository);

      for (let i = 0; i < 100 && !store.failedFolderDeletes().has(a); i++) await flush();
      expect(store.failedFolderDeletes().has(a)).toBe(true);
      expect(folderRepository.records.get(a)?.status).toBe('deleting');
    });
  });
});

/** A store bound to a pre-seeded repository — for startup-state tests. */
function setupLate(repository: FakeDocumentRepository, folderRepository = new FakeFolderRepository()) {
  const jobs = { cancelJobsFor: vi.fn() };
  TestBed.configureTestingModule({
    providers: [
      { provide: DOCUMENT_REPOSITORY, useValue: repository },
      { provide: FOLDER_REPOSITORY, useValue: folderRepository },
      { provide: UploadPipeline, useFactory: () => new UploadPipeline(repository) },
      { provide: HostBus, useValue: jobs },
      { provide: Router, useValue: fakeRouter },
      LibraryStore,
    ],
  });
  return {
    repository,
    folderRepository,
    jobs,
    store: TestBed.inject(LibraryStore),
    toasts: TestBed.inject(ToastService),
    open: TestBed.inject(OpenDocument),
  };
}
