import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { NEVER } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { ExtractionRecord, SessionUser } from '@klartext/bus-contract';
import { legacyV1ExtractionFixtures, normalizeExtractionRecord } from '@klartext/bus-contract';
import { AuthService } from '../auth.service';
import type { DocumentRecord } from '../data/document';
import type { FolderRecord } from '../data/folder';
import { DOCUMENT_REPOSITORY, EXTRACTION_REPOSITORY, FOLDER_REPOSITORY } from '../data/providers';
import { UploadPipeline } from '../data/upload-pipeline';
import { LibraryStore } from '../library/library.store';
import { Reminders } from '../reminders/reminders';
import { ToastService } from '../toasts/toast.service';
import { BatchReanalysis } from './batch-reanalysis';
import { ExtractionFlow } from './extraction-flow';
import {
  FakeDocumentRepository,
  FakeExtractionRepository,
  RECORDED_FAILURE,
  candidate,
  fakeFolderRepository,
  flush,
  folderRecord,
  jobDocument,
  storedRecord,
} from './extraction-flow.spec-support';
import { HostBus } from './host-bus';
import { HostBusEvents } from './host-bus-events';

const USER: SessionUser = { uid: 'u1', displayName: 'Test User', email: 'test-user@test.com' };

const fakeRouter = {
  events: NEVER,
  routerState: { snapshot: { root: { firstChild: null } } },
  navigate: vi.fn(async () => true),
};

/** A stored `schemaVersion: 1` Extraction, normalized as the index holds it. */
function outdatedRecord(documentId: string): ExtractionRecord {
  return normalizeExtractionRecord({
    ...legacyV1ExtractionFixtures['doc-versicherungsschein']!,
    documentId,
    createdAt: { seconds: 1_700_000_000, nanoseconds: 0 },
  });
}

interface Library {
  repository: FakeDocumentRepository;
  extractions: FakeExtractionRepository;
  folders?: FolderRecord[];
}

/** A library to seed before the services start — the sweep reads it on load. */
function library(): Library {
  return { repository: new FakeDocumentRepository(), extractions: new FakeExtractionRepository() };
}

async function seedOutdated(lib: Library, overrides: Partial<DocumentRecord> = {}) {
  const doc = await lib.repository.seed({ status: 'ready', ...overrides });
  lib.extractions.records.set(doc.id, outdatedRecord(doc.id));
  return doc;
}

async function seedCurrent(lib: Library, overrides: Partial<DocumentRecord> = {}) {
  const doc = await lib.repository.seed({ status: 'ready', ...overrides });
  lib.extractions.records.set(doc.id, storedRecord(doc.id));
  return doc;
}

async function seedFailed(lib: Library, overrides: Partial<DocumentRecord> = {}) {
  return lib.repository.seed({ status: 'ready', extractionFailure: RECORDED_FAILURE, ...overrides });
}

async function setup(lib: Library = library()) {
  const bus = {
    openSession: vi.fn(),
    requestExtraction: vi.fn(),
    cancelJobsFor: vi.fn(),
    pushActionItemStates: vi.fn(),
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: DOCUMENT_REPOSITORY, useValue: lib.repository },
      { provide: FOLDER_REPOSITORY, useValue: fakeFolderRepository(lib.folders) },
      { provide: EXTRACTION_REPOSITORY, useValue: lib.extractions },
      { provide: UploadPipeline, useFactory: () => new UploadPipeline(lib.repository) },
      { provide: HostBus, useValue: bus },
      {
        provide: AuthService,
        useValue: { user: signal(USER), idToken: vi.fn(async () => 'id-token') },
      },
      { provide: Router, useValue: fakeRouter },
      HostBusEvents,
      LibraryStore,
      Reminders,
      ExtractionFlow,
      BatchReanalysis,
    ],
  });
  const flow = TestBed.inject(ExtractionFlow);
  const batch = TestBed.inject(BatchReanalysis);
  const tick = () => TestBed.tick();
  // Let the load sweep index every stored Extraction.
  tick();
  await flush();
  return {
    ...lib,
    bus,
    flow,
    batch,
    tick,
    store: TestBed.inject(LibraryStore),
    toasts: TestBed.inject(ToastService),
  };
}

const ids = (docs: DocumentRecord[] | undefined) => (docs ?? []).map((d) => d.id).sort();

// Issue #158, ADR 0015: the criteria are signals over the library and the
// Extraction index, scoped to a Folder and everything nested inside it.
describe('BatchReanalysis — criteria (issue #158)', () => {
  it('splits the scope into Outdated format, Couldn\'t analyze and All documents', async () => {
    const lib = library();
    const outdated = await seedOutdated(lib);
    const current = await seedCurrent(lib);
    const failed = await seedFailed(lib);
    const failedButAnalyzed = await seedOutdated(lib, { extractionFailure: RECORDED_FAILURE });
    const { batch } = await setup(lib);

    const candidates = batch.candidates(null)();

    expect(ids(candidates?.outdated)).toEqual(ids([outdated, failedButAnalyzed]));
    // A recorded failure counts only while no Extraction is stored.
    expect(ids(candidates?.failed)).toEqual(ids([failed]));
    expect(ids(candidates?.all)).toEqual(ids([outdated, current, failed, failedButAnalyzed]));
  });

  it('reaches Documents in nested Folders, and nothing outside the scope', async () => {
    const lib = library();
    lib.folders = [
      folderRecord('parent', null),
      folderRecord('nested', 'parent'),
      folderRecord('sibling', null),
    ];
    const inParent = await seedOutdated(lib, { folderId: 'parent' });
    const inNested = await seedOutdated(lib, { folderId: 'nested' });
    await seedOutdated(lib, { folderId: 'sibling' });
    await seedOutdated(lib, { folderId: null });
    const { batch } = await setup(lib);

    expect(ids(batch.candidates('parent')()?.outdated)).toEqual(ids([inParent, inNested]));
    expect(ids(batch.candidates('nested')()?.outdated)).toEqual(ids([inNested]));
    expect(batch.candidates(null)()?.outdated).toHaveLength(4);
  });

  it('excludes never-analyzed, in-flight and non-ready Documents', async () => {
    const lib = library();
    const kept = await seedOutdated(lib);
    await seedOutdated(lib, { status: 'uploading' });
    await seedOutdated(lib, { status: 'deleting' });
    // Never analyzed: auto-enqueued on load, so already `queued`.
    await lib.repository.seed({ status: 'ready' });
    const running = await seedFailed(lib);
    const { batch, store } = await setup(lib);
    store.setExtractionJob(running.id, 'running');

    const candidates = batch.candidates(null)();

    expect(ids(candidates?.all)).toEqual(ids([kept]));
  });

  it('drops a Document from the criteria once its re-analysis upgrades it', async () => {
    const lib = library();
    const doc = await seedOutdated(lib);
    const { batch, flow } = await setup(lib);
    const candidates = batch.candidates(null);
    expect(ids(candidates()?.outdated)).toEqual([doc.id]);

    flow.jobSucceeded('job-1', candidate(doc.id));
    await flush();

    expect(candidates()?.outdated).toEqual([]);
    expect(ids(candidates()?.all)).toEqual([doc.id]);
  });

  it('is honest about the index: null until every stored Extraction is read', async () => {
    const lib = library();
    await seedOutdated(lib);
    const { batch, store } = await setup(lib);
    store.extractionsLoaded.set(false);

    expect(batch.candidates(null)()).toBeNull();
  });
});

/** The Document ids handed to the Bus, with the priority each was queued at. */
const enqueued = (bus: { requestExtraction: ReturnType<typeof vi.fn> }) =>
  bus.requestExtraction.mock.calls.map(([doc, , priority]) => [
    (doc as { documentId: string }).documentId,
    priority,
  ]);

// Issue #158: a batch's members are ordinary Extraction Jobs through the
// retry path, queued at batch priority; one batch runs at a time.
describe('BatchReanalysis — start (issue #158)', () => {
  it('enqueues every match at batch priority with fresh bytes', async () => {
    const lib = library();
    const a = await seedOutdated(lib);
    const b = await seedOutdated(lib);
    await seedCurrent(lib);
    const { batch, bus } = await setup(lib);

    expect(batch.start(null, 'outdated')).toBe(true);
    await flush();

    expect(enqueued(bus)).toEqual([
      [a.id, 'batch'],
      [b.id, 'batch'],
    ]);
    expect(batch.progress()).toEqual({ running: true, done: 0, total: 2 });
  });

  it('clears a Couldn\'t-analyze member\'s failure record before re-running it', async () => {
    const lib = library();
    const failed = await seedFailed(lib);
    const { batch, bus, repository } = await setup(lib);

    batch.start(null, 'failed');
    await flush();

    expect(repository.records.get(failed.id)?.extractionFailure).toBeNull();
    expect(enqueued(bus)).toEqual([[failed.id, 'batch']]);
  });

  it('marks members queued so the criteria stop counting them', async () => {
    const lib = library();
    await seedOutdated(lib);
    const { batch } = await setup(lib);
    const candidates = batch.candidates(null);

    batch.start(null, 'outdated');

    expect(candidates()?.outdated).toEqual([]);
  });

  it('runs one batch at a time', async () => {
    const lib = library();
    await seedOutdated(lib);
    await seedFailed(lib);
    const { batch, bus } = await setup(lib);

    expect(batch.start(null, 'outdated')).toBe(true);
    expect(batch.start(null, 'failed')).toBe(false);
    await flush();

    expect(bus.requestExtraction).toHaveBeenCalledTimes(1);
  });

  it('refuses an empty selection, or one asked for before the index is loaded', async () => {
    const lib = library();
    await seedCurrent(lib);
    const { batch, store } = await setup(lib);

    expect(batch.start(null, 'outdated')).toBe(false);
    store.extractionsLoaded.set(false);
    expect(batch.start(null, 'all')).toBe(false);
    expect(batch.progress()).toEqual({ running: false, done: 0, total: 0 });
  });
});

const AI_DOWN = { code: 'AI_UNAVAILABLE' as const, message: 'No response.', retryable: true };

type Harness = Awaited<ReturnType<typeof setup>>;

/** Runs a member's job to success, as the adapter would report it. */
async function succeed(h: Harness, doc: DocumentRecord): Promise<void> {
  h.flow.jobStarted(`job-${doc.id}`, jobDocument(doc.id, doc.title));
  h.flow.jobSucceeded(`job-${doc.id}`, candidate(doc.id));
  await flush();
}

/** Runs a member's job to failure, as the adapter would report it. */
async function fail(h: Harness, doc: DocumentRecord): Promise<void> {
  h.flow.jobStarted(`job-${doc.id}`, jobDocument(doc.id, doc.title));
  h.flow.jobFailedFor(`job-${doc.id}`, jobDocument(doc.id, doc.title), AI_DOWN);
  await flush();
}

const titles = (h: Harness) => h.toasts.toasts().map((t) => t.title);

// Issue #158: batch members raise no per-Document toasts; one summary lands
// when the last member settles, its Try again re-running only the failures.
describe('BatchReanalysis — outcomes (issue #158)', () => {
  it('suppresses per-Document toasts and summarizes a clean run', async () => {
    const lib = library();
    const a = await seedOutdated(lib, { title: 'Alpha' });
    const b = await seedOutdated(lib, { title: 'Beta' });
    const h = await setup(lib);
    h.batch.start(null, 'outdated');
    await flush();

    await succeed(h, a);
    expect(h.batch.progress()).toEqual({ running: true, done: 1, total: 2 });
    await succeed(h, b);

    expect(titles(h)).toEqual(['Re-analyzed 2 documents']);
    expect(h.batch.progress()).toEqual({ running: false, done: 0, total: 0 });
    // The Extractions persisted — the members are no longer Outdated.
    expect(h.extractions.saves.map((s) => s.documentId)).toEqual([a.id, b.id]);
  });

  it('a failed member keeps its prior Extraction and records the failure, quietly', async () => {
    const lib = library();
    const a = await seedOutdated(lib, { title: 'Alpha' });
    const b = await seedOutdated(lib, { title: 'Beta' });
    const h = await setup(lib);
    const prior = h.store.extractionsByDocId().get(a.id);
    h.batch.start(null, 'outdated');
    await flush();

    await fail(h, a);
    await succeed(h, b);

    expect(h.store.extractionsByDocId().get(a.id)).toBe(prior);
    expect(h.repository.records.get(a.id)?.extractionFailure).toMatchObject({
      code: 'AI_UNAVAILABLE',
    });
    expect(titles(h)).toEqual(["Re-analyzed 1 of 2 — 1 couldn't be analyzed"]);
  });

  it('Try again on the summary re-runs only the failed members', async () => {
    const lib = library();
    const a = await seedOutdated(lib);
    const b = await seedOutdated(lib);
    const c = await seedOutdated(lib);
    const h = await setup(lib);
    h.batch.start(null, 'outdated');
    await flush();
    await fail(h, a);
    await succeed(h, b);
    await fail(h, c);
    h.tick();
    await flush();
    h.bus.requestExtraction.mockClear();

    const summary = h.toasts.toasts().find((t) => t.action?.label === 'Try again');
    expect(summary?.title).toBe("Re-analyzed 1 of 3 — 2 couldn't be analyzed");
    summary!.action!.run();
    await flush();

    expect(enqueued(h.bus)).toEqual([
      [a.id, 'batch'],
      [c.id, 'batch'],
    ]);
    expect(h.batch.progress()).toEqual({ running: true, done: 0, total: 2 });
  });

  it('a Document requested outside the batch still toasts as before', async () => {
    const lib = library();
    const member = await seedOutdated(lib, { title: 'Member' });
    const other = await seedFailed(lib, { title: 'Other' });
    const h = await setup(lib);
    h.batch.start(null, 'outdated');
    await flush();

    expect(h.flow.retryRequested(other.id)).toBe(true);
    await flush();
    await succeed(h, other);

    expect(titles(h)).toEqual(['"Other" is ready']);
    void member;
  });
});

// Issue #158, ADR 0015: three consecutive failures stop the batch instead of
// recording a failure on every remaining Document.
describe('BatchReanalysis — consecutive-failure stop (issue #158)', () => {
  async function sixOutdated() {
    const lib = library();
    const docs: DocumentRecord[] = [];
    for (let i = 0; i < 6; i++) docs.push(await seedOutdated(lib, { title: `Doc ${i}` }));
    const h = await setup(lib);
    h.batch.start(null, 'outdated');
    await flush();
    return { h, docs };
  }

  it('stops after three failures in a row, leaving the rest unstarted', async () => {
    const { h, docs } = await sixOutdated();

    await succeed(h, docs[0]!);
    await fail(h, docs[1]!);
    await fail(h, docs[2]!);
    await fail(h, docs[3]!);

    expect(h.bus.cancelJobsFor.mock.calls.map(([id]) => id)).toEqual([docs[4]!.id, docs[5]!.id]);
    expect(h.store.extractionJobs().has(docs[4]!.id)).toBe(false);
    // The unstarted members never ran: no failure recorded, prior Extraction kept.
    expect(h.repository.records.get(docs[4]!.id)?.extractionFailure).toBeNull();
    expect(titles(h)).toEqual(['Re-analysis stopped — AI is unavailable right now. 1 of 6 done.']);
    expect(h.batch.progress().running).toBe(false);
  });

  it('a success resets the count', async () => {
    const { h, docs } = await sixOutdated();

    await fail(h, docs[0]!);
    await fail(h, docs[1]!);
    await succeed(h, docs[2]!);
    await fail(h, docs[3]!);
    await fail(h, docs[4]!);

    expect(h.bus.cancelJobsFor).not.toHaveBeenCalled();
    expect(h.batch.progress()).toEqual({ running: true, done: 5, total: 6 });
  });

  it('Try again re-runs the failed and the unstarted members', async () => {
    const { h, docs } = await sixOutdated();
    await succeed(h, docs[0]!);
    for (const doc of docs.slice(1, 4)) await fail(h, doc);
    h.tick();
    await flush();
    h.bus.requestExtraction.mockClear();

    h.toasts.toasts().find((t) => t.action?.label === 'Try again')!.action!.run();
    await flush();

    expect(enqueued(h.bus).map(([id]) => id).sort()).toEqual(
      docs.slice(1).map((d) => d.id).sort(),
    );
  });
});

// Issue #158: Cancel drops every unstarted member; the running job finishes
// and persists. Uploads and other user-initiated jobs are untouched.
describe('BatchReanalysis — cancel (issue #158)', () => {
  it('drops the unstarted members while the running one finishes and persists', async () => {
    const lib = library();
    const running = await seedOutdated(lib, { title: 'Running' });
    const waiting = await seedOutdated(lib, { title: 'Waiting' });
    const h = await setup(lib);
    h.batch.start(null, 'outdated');
    await flush();
    h.flow.jobStarted('job-1', jobDocument(running.id));

    h.batch.cancel();

    expect(h.bus.cancelJobsFor.mock.calls.map(([id]) => id)).toEqual([waiting.id]);
    expect(h.batch.progress().running).toBe(false);
    expect(titles(h)).toEqual(['Re-analysis cancelled']);

    h.flow.jobSucceeded('job-1', candidate(running.id));
    await flush();
    expect(h.extractions.saves.map((s) => s.documentId)).toEqual([running.id]);
    // Still a batch member: no "is ready" toast, and no summary.
    expect(titles(h)).toEqual(['Re-analysis cancelled']);
  });

  it('leaves upload and user-initiated jobs queued', async () => {
    const lib = library();
    await seedOutdated(lib);
    await seedOutdated(lib);
    const failed = await seedFailed(lib);
    const h = await setup(lib);
    h.batch.start(null, 'outdated');
    await flush();
    h.flow.retryRequested(failed.id);
    await flush();
    // A new upload reaches ready mid-batch and auto-enqueues.
    const uploaded = await lib.repository.seed({ status: 'ready' });
    h.tick();
    await flush();

    h.batch.cancel();

    const cancelled = h.bus.cancelJobsFor.mock.calls.map(([id]) => id);
    expect(cancelled).not.toContain(failed.id);
    expect(cancelled).not.toContain(uploaded.id);
    expect(h.store.extractionJobs().get(failed.id)).toBe('queued');
    expect(h.store.extractionJobs().get(uploaded.id)).toBe('queued');
  });

  it('restores a dropped Couldn\'t-analyze member\'s failure record', async () => {
    const lib = library();
    const first = await seedFailed(lib);
    const second = await seedFailed(lib);
    const h = await setup(lib);
    h.batch.start(null, 'failed');
    await flush();
    expect(h.repository.records.get(second.id)?.extractionFailure).toBeNull();
    h.flow.jobStarted('job-1', jobDocument(first.id));

    h.batch.cancel();
    await flush();
    h.tick();

    expect(h.repository.records.get(second.id)?.extractionFailure).toMatchObject({
      code: RECORDED_FAILURE.code,
    });
    expect(ids(h.batch.candidates(null)()?.failed)).toEqual([second.id]);
  });

  it('a member still fetching its bytes is never enqueued', async () => {
    const lib = library();
    await seedOutdated(lib);
    const h = await setup(lib);
    h.batch.start(null, 'outdated');

    h.batch.cancel();
    await flush();

    expect(h.bus.requestExtraction).not.toHaveBeenCalled();
  });

  it('a new batch can start once cancelled', async () => {
    const lib = library();
    await seedOutdated(lib);
    await seedFailed(lib);
    const h = await setup(lib);
    h.batch.start(null, 'outdated');
    h.batch.cancel();

    expect(h.batch.start(null, 'failed')).toBe(true);
  });
});

// A member deleted mid-batch never settles — the batch forgets it rather
// than waiting forever.
describe('BatchReanalysis — deleted members (issue #158)', () => {
  it('drops a member that leaves the library and still finishes', async () => {
    const lib = library();
    const kept = await seedOutdated(lib);
    const deleted = await seedOutdated(lib);
    const h = await setup(lib);
    h.batch.start(null, 'outdated');
    await flush();

    await lib.repository.setStatus(deleted.id, 'deleting');
    h.tick();
    expect(h.batch.progress()).toEqual({ running: true, done: 0, total: 1 });
    await succeed(h, kept);

    expect(titles(h)).toEqual(['Re-analyzed 1 document']);
  });

  it('summarizes when the last pending member is the one deleted', async () => {
    const lib = library();
    const kept = await seedOutdated(lib);
    const deleted = await seedOutdated(lib);
    const h = await setup(lib);
    h.batch.start(null, 'outdated');
    await flush();
    await succeed(h, kept);

    lib.repository.records.delete(deleted.id);
    lib.repository.emit();
    h.tick();

    expect(h.batch.progress().running).toBe(false);
    expect(titles(h)).toEqual(['Re-analyzed 1 document']);
  });
});
