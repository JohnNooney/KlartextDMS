/**
 * Shared doubles for the specs that drive `ExtractionFlow` over fake
 * repositories (issues #31, #158): a snapshot-emitting Document repository,
 * an in-memory Extraction repository, a Folder feed, and fixture builders.
 */
import { goldenFixtureMessages, normalizeExtractionRecord } from '@klartext/bus-contract';
import type {
  ActionItemStates,
  ExtractionCandidate,
  ExtractionRecord,
  JobDocument,
} from '@klartext/bus-contract';
import type {
  DocumentRecord,
  DocumentStatus,
  ExtractionFailure,
  NewDocument,
} from '../data/document';
import type { DocumentRepository, DocumentUpload } from '../data/document-repository';
import type { ExtractionRepository } from '../data/extraction-repository';
import type { FolderRecord } from '../data/folder';
import type { FolderRepository } from '../data/folder-repository';

export const BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer;

export function candidate(documentId: string): ExtractionCandidate {
  return {
    ...goldenFixtureMessages.AI_PROCESSING_SUCCESS.payload.extraction,
    documentId,
  };
}

export function storedRecord(documentId: string): ExtractionRecord {
  return normalizeExtractionRecord({
    ...candidate(documentId),
    createdAt: { seconds: 1_700_000_000, nanoseconds: 0 },
  });
}

export function jobDocument(documentId: string, documentTitle = 'seed'): JobDocument {
  return { documentId, documentTitle, contentType: 'application/pdf' };
}

/** A recorded Extraction failure as `extractionFailure` stores it. */
export const RECORDED_FAILURE: ExtractionFailure = {
  code: 'AI_UNAVAILABLE',
  message: 'No response.',
  retryable: true,
  failedAt: { seconds: 1, nanoseconds: 0 },
};

/** Snapshot-emitting DocumentRepository double — same shape as the store spec's. */
export class FakeDocumentRepository implements DocumentRepository {
  readonly records = new Map<string, DocumentRecord>();
  readonly calls: string[] = [];
  readonly bytesByDoc = new Map<string, ArrayBuffer>();

  private seq = 0;
  private readonly listeners = new Set<(documents: DocumentRecord[]) => void>();

  emit(): void {
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
      extractionFailure: null,
      folderId: input.folderId,
      createdAt: { seconds: 1, nanoseconds: 0 },
      updatedAt: { seconds: 1, nanoseconds: 0 },
    };
    this.records.set(id, record);
    this.emit();
    return { ...record };
  }

  async setStatus(documentId: string, status: DocumentStatus): Promise<void> {
    const record = this.records.get(documentId);
    if (!record) throw notFound();
    this.records.set(documentId, { ...record, status });
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

  async setActionItemStates(documentId: string, states: ActionItemStates): Promise<void> {
    this.calls.push(`action-item-states:${documentId}`);
    const record = this.records.get(documentId);
    if (!record) throw notFound();
    this.records.set(documentId, { ...record, actionItemStates: states });
    this.emit();
  }

  async rename(): Promise<void> {}
  async setFolder(): Promise<void> {}
  async delete(): Promise<void> {}

  async getBytes(documentId: string): Promise<ArrayBuffer> {
    return this.bytesByDoc.get(documentId) ?? BYTES;
  }

  uploadBytes(): DocumentUpload {
    throw new Error('not used');
  }

  /** Seeds a Document straight into the feed under `overrides`. */
  async seed(overrides: Partial<DocumentRecord> = {}): Promise<DocumentRecord> {
    const record = await this.create({
      title: 'seed',
      originalFilename: 'seed.pdf',
      sizeBytes: 4,
      folderId: null,
    });
    this.records.set(record.id, { ...record, status: 'ready', ...overrides });
    this.emit();
    return this.records.get(record.id)!;
  }
}

export class FakeExtractionRepository implements ExtractionRepository {
  readonly records = new Map<string, ExtractionRecord>();
  readonly saves: Array<{ documentId: string; extraction: ExtractionCandidate }> = [];

  async get(documentId: string): Promise<ExtractionRecord | null> {
    return this.records.get(documentId) ?? null;
  }

  async save(documentId: string, extraction: ExtractionCandidate): Promise<void> {
    this.saves.push({ documentId, extraction });
    this.records.set(
      documentId,
      normalizeExtractionRecord({
        ...extraction,
        createdAt: { seconds: 1_700_000_000, nanoseconds: 0 },
      }),
    );
  }
}

/** A Folder feed that emits a fixed tree once. */
export function fakeFolderRepository(folders: FolderRecord[] = []): FolderRepository {
  return {
    watch: (emit: (folders: FolderRecord[]) => void) => {
      emit(folders);
      return () => {};
    },
  } as unknown as FolderRepository;
}

/** A `ready` Folder record under `parentId`. */
export function folderRecord(id: string, parentId: string | null): FolderRecord {
  return {
    id,
    name: id,
    parentId,
    status: 'ready',
    createdAt: { seconds: 1, nanoseconds: 0 },
    updatedAt: { seconds: 1, nanoseconds: 0 },
  };
}

export async function flush(): Promise<void> {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

function notFound(): Error {
  return Object.assign(new Error('not found'), { code: 'not-found' });
}
