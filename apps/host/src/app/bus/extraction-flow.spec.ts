import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { NEVER } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { SessionUser } from '@klartext/bus-contract';
import type {
  ExtractionCandidate,
  ExtractionRecord,
  JobDocument,
  Session,
} from '@klartext/bus-contract';
import { goldenFixtureMessages } from '@klartext/bus-contract';
import { AuthService } from '../auth.service';
import type {
  DocumentRecord,
  DocumentStatus,
  ExtractionFailure,
  NewDocument,
} from '../data/document';
import type { DocumentRepository, DocumentUpload } from '../data/document-repository';
import type { ExtractionRepository } from '../data/extraction-repository';
import type { FolderRepository } from '../data/folder-repository';
import {
  DOCUMENT_REPOSITORY,
  EXTRACTION_REPOSITORY,
  FOLDER_REPOSITORY,
} from '../data/providers';
import { UploadPipeline } from '../data/upload-pipeline';
import { LibraryStore } from '../library/library.store';
import { OpenDocument } from '../open-document';
import { ToastService } from '../toasts/toast.service';
import { ExtractionFlow } from './extraction-flow';
import { HostBus } from './host-bus';
import { HostBusEvents } from './host-bus-events';

const USER: SessionUser = { uid: 'u1', displayName: 'Test User', email: 'test-user@test.com' };
const BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer;

function candidate(documentId: string): ExtractionCandidate {
  return {
    ...goldenFixtureMessages.AI_PROCESSING_SUCCESS.payload.extraction,
    documentId,
  };
}

function storedRecord(documentId: string): ExtractionRecord {
  return { ...candidate(documentId), createdAt: { seconds: 1_700_000_000, nanoseconds: 0 } };
}

function jobDocument(documentId: string, documentTitle = 'seed'): JobDocument {
  return { documentId, documentTitle, contentType: 'application/pdf' };
}

/** Snapshot-emitting DocumentRepository double — same shape as the store spec's. */
class FakeDocumentRepository implements DocumentRepository {
  readonly records = new Map<string, DocumentRecord>();
  readonly calls: string[] = [];
  readonly bytesByDoc = new Map<string, ArrayBuffer>();

  private seq = 0;
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

class FakeExtractionRepository implements ExtractionRepository {
  readonly records = new Map<string, ExtractionRecord>();
  readonly saves: Array<{ documentId: string; extraction: ExtractionCandidate }> = [];

  async get(documentId: string): Promise<ExtractionRecord | null> {
    return this.records.get(documentId) ?? null;
  }

  async save(documentId: string, extraction: ExtractionCandidate): Promise<void> {
    this.saves.push({ documentId, extraction });
    this.records.set(documentId, {
      ...extraction,
      createdAt: { seconds: 1_700_000_000, nanoseconds: 0 },
    });
  }
}

function notFound(): Error {
  return Object.assign(new Error('not found'), { code: 'not-found' });
}

const fakeFolderRepository = {
  watch: vi.fn((emit: (folders: never[]) => void) => {
    emit([]);
    return () => {};
  }),
} as unknown as FolderRepository;

const fakeRouter = {
  events: NEVER,
  routerState: { snapshot: { root: { firstChild: null } } },
  navigate: vi.fn(async () => true),
};

async function flush(): Promise<void> {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

function setup(repository = new FakeDocumentRepository()) {
  const extractions = new FakeExtractionRepository();
  const bus = {
    openSession: vi.fn(),
    requestExtraction: vi.fn(),
    cancelJobsFor: vi.fn(),
  };
  const auth = {
    user: signal<SessionUser | null | undefined>(USER),
    idToken: vi.fn(async () => 'id-token'),
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: DOCUMENT_REPOSITORY, useValue: repository },
      { provide: FOLDER_REPOSITORY, useValue: fakeFolderRepository },
      { provide: EXTRACTION_REPOSITORY, useValue: extractions },
      { provide: UploadPipeline, useFactory: () => new UploadPipeline(repository) },
      { provide: HostBus, useValue: bus },
      { provide: AuthService, useValue: auth },
      { provide: Router, useValue: fakeRouter },
      HostBusEvents,
      LibraryStore,
      ExtractionFlow,
    ],
  });
  const flow = TestBed.inject(ExtractionFlow);
  const tick = () => TestBed.tick();
  return {
    repository,
    extractions,
    bus,
    flow,
    tick,
    events: TestBed.inject(HostBusEvents),
    toasts: TestBed.inject(ToastService),
    open: TestBed.inject(OpenDocument),
  };
}

/** All INIT_SESSION payloads the fake Bus was handed. */
function sessions(bus: { openSession: ReturnType<typeof vi.fn> }): Session[] {
  return bus.openSession.mock.calls.map(([session]) => session as Session);
}

describe('ExtractionFlow — Extraction Job orchestration (issue #31)', () => {
  it('enqueues an Extraction Job when a Document reaches ready', async () => {
    const { repository, bus, tick } = setup();
    const doc = await repository.seed({ status: 'uploading' });
    await flush();
    tick();
    expect(bus.requestExtraction).not.toHaveBeenCalled();

    await repository.setStatus(doc.id, 'ready');
    tick();
    await flush();

    expect(bus.requestExtraction).toHaveBeenCalledTimes(1);
    const [document, bytes] = bus.requestExtraction.mock.calls[0]!;
    expect(document).toMatchObject({ documentId: doc.id, contentType: 'application/pdf' });
    expect(bytes).toBe(BYTES);
  });

  it('re-queues on load only ready Documents with no Extraction and no failure', async () => {
    const repository = new FakeDocumentRepository();
    const needsJob = await repository.seed({ status: 'ready' });
    const withExtraction = await repository.seed({ status: 'ready' });
    const failed = await repository.seed({
      status: 'ready',
      extractionFailure: {
        code: 'AI_UNAVAILABLE',
        message: 'No response.',
        retryable: true,
        failedAt: { seconds: 1, nanoseconds: 0 },
      },
    });
    const { extractions, bus, tick } = setup(repository);
    extractions.records.set(withExtraction.id, storedRecord(withExtraction.id));

    tick();
    await flush();

    const enqueued = bus.requestExtraction.mock.calls.map(
      ([doc]) => (doc as JobDocument).documentId,
    );
    expect(enqueued).toEqual([needsJob.id]);
    expect(enqueued).not.toContain(withExtraction.id);
    expect(enqueued).not.toContain(failed.id);
  });

  it('does not re-enqueue a Document it already queued this session', async () => {
    const { repository, bus, tick } = setup();
    await repository.seed({ status: 'ready' });
    tick();
    await flush();
    expect(bus.requestExtraction).toHaveBeenCalledTimes(1);
  });

  it('opening a Document sends INIT_SESSION with the stored Extraction', async () => {
    const { repository, extractions, bus, open, tick } = setup();
    const doc = await repository.seed({ status: 'ready' });
    const record = storedRecord(doc.id);
    extractions.records.set(doc.id, record);
    tick();
    await flush();
    // A Document with an Extraction is never queued.
    expect(bus.requestExtraction).not.toHaveBeenCalled();

    open.open({ id: doc.id, folderId: null });
    tick();
    await flush();

    expect(bus.openSession).toHaveBeenCalledTimes(1);
    const session = sessions(bus)[0]!;
    expect(session).toMatchObject({
      documentId: doc.id,
      documentTitle: 'seed',
      user: USER,
      authToken: 'id-token',
      extraction: record,
      extractionState: 'none',
    });
    expect(session.sessionId).toBeTruthy();
  });

  it('sends extractionState queued→running while the open Document\'s job is in flight', async () => {
    const { repository, bus, flow, open, tick } = setup();
    const doc = await repository.seed({ status: 'ready' });
    tick();
    await flush();
    open.open({ id: doc.id, folderId: null });
    tick();
    await flush();

    expect(sessions(bus).at(-1)).toMatchObject({ extractionState: 'queued' });

    flow.jobStarted('job-1', jobDocument(doc.id));
    tick();
    await flush();
    expect(sessions(bus).at(-1)).toMatchObject({ extractionState: 'running' });
  });

  it('a recorded failure is reflected in the open Document\'s Session', async () => {
    const { repository, bus, flow, open, tick } = setup();
    const doc = await repository.seed({ status: 'ready' });
    tick();
    await flush();
    open.open({ id: doc.id, folderId: null });
    tick();
    await flush();

    const error = { code: 'QUOTA_EXCEEDED' as const, message: 'Quota.', retryable: true };
    flow.jobFailedFor('job-1', jobDocument(doc.id), error);
    tick();
    await flush();

    expect(repository.calls).toContain(`extraction-failure:${doc.id}`);
    expect(repository.records.get(doc.id)?.extractionFailure).toMatchObject({
      code: 'QUOTA_EXCEEDED',
    });
    expect(sessions(bus).at(-1)).toMatchObject({ extractionState: 'failed' });
  });

  it('persists a successful job\'s Extraction under extractions/current', async () => {
    const { repository, extractions, bus, flow, open, tick } = setup();
    const doc = await repository.seed({ status: 'ready' });
    tick();
    await flush();
    open.open({ id: doc.id, folderId: null });
    tick();
    await flush();
    expect(bus.openSession).toHaveBeenCalledTimes(1);

    const extraction = candidate(doc.id);
    flow.jobSucceeded('job-1', extraction);
    await flush();
    tick();
    await flush();

    expect(extractions.saves).toEqual([{ documentId: doc.id, extraction }]);
    // The adapter resends INIT_SESSION itself on success — the app does not double-send.
    expect(bus.openSession).toHaveBeenCalledTimes(1);
  });

  it('toasts on a background job\'s success and failure, not when open', async () => {
    const { repository, extractions, bus, flow, open, toasts, tick } = setup();
    const openDoc = await repository.seed({ status: 'ready', title: 'open doc' });
    const background = await repository.seed({ status: 'ready', title: 'background doc' });
    extractions.records.set(openDoc.id, storedRecord(openDoc.id));
    tick();
    await flush();
    open.open({ id: openDoc.id, folderId: null });
    tick();
    await flush();
    void bus;

    flow.jobSucceeded('job-1', candidate(background.id));
    await flush();
    flow.jobFailedFor(
      'job-2',
      jobDocument('doc-404', 'lost doc'),
      { code: 'AI_UNAVAILABLE', message: 'No response.', retryable: true },
    );
    await flush();

    const titles = toasts.toasts().map((t) => t.title);
    expect(titles).toContain('"background doc" is ready');
    expect(titles).toContain('Couldn\'t analyze lost doc');
    expect(titles.some((t) => t.includes('open doc'))).toBe(false);
  });

  it('retry clears the failure record and re-enqueues with fresh bytes', async () => {
    const repository = new FakeDocumentRepository();
    const doc = await repository.seed({
      status: 'ready',
      extractionFailure: {
        code: 'AI_UNAVAILABLE',
        message: 'No response.',
        retryable: true,
        failedAt: { seconds: 1, nanoseconds: 0 },
      },
    });
    const { bus, flow, tick } = setup(repository);
    tick();
    await flush();
    expect(bus.requestExtraction).not.toHaveBeenCalled();

    expect(flow.retryRequested(doc.id)).toBe(true);
    await flush();

    expect(repository.calls).toContain(`extraction-failure:${doc.id}`);
    expect(repository.records.get(doc.id)?.extractionFailure).toBeNull();
    expect(bus.requestExtraction).toHaveBeenCalledTimes(1);
    expect(bus.requestExtraction.mock.calls[0]![0]).toMatchObject({
      documentId: doc.id,
    });
  });

  it('accepts a retry for an unknown Document without re-queuing', async () => {
    const { bus, flow, tick } = setup();
    tick();
    await flush();

    expect(flow.retryRequested('doc-gone')).toBe(true);
    await flush();
    expect(bus.requestExtraction).not.toHaveBeenCalled();
  });

  it('surfaces a Session watchdog failure as a toast', () => {
    const { flow, toasts, tick } = setup();
    tick();

    flow.sessionFailed('sess-1', {
      code: 'AI_UNAVAILABLE',
      message: 'The document assistant is not responding.',
      retryable: true,
    });

    expect(toasts.toasts().map((t) => t.title)).toContain(
      'The document assistant is not responding.',
    );
  });

  it('the events surface delegates Bus outcomes to the flow', async () => {
    const { repository, events, extractions, tick } = setup();
    const doc = await repository.seed({ status: 'ready' });
    tick();
    await flush();

    events.jobSucceeded('job-1', candidate(doc.id));
    await flush();
    expect(extractions.saves).toHaveLength(1);
  });
});
