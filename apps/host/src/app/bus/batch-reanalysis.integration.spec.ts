// @vitest-environment jsdom
// Runs under `pnpm test:integration` — inside `firebase emulators:exec`
// (issue #158, ADR 0015). A Batch re-analysis over a Folder, end to end:
// the real BatchReanalysis, ExtractionFlow and LibraryStore over the
// Firestore repositories, the Host Bus adapter linked to the loopback Guest,
// and stored `schemaVersion: 1` Extractions upgraded to v2.
//
// jsdom, not Node: Angular's platform-browser needs `document`. Firestore
// works under jsdom; Storage doesn't (`storage/unknown`), so the bytes
// stages are stubbed — the PDF is the Guest's concern, not this seam's.
import '@angular/compiler';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { Router } from '@angular/router';
import { NEVER } from 'rxjs';
import { setDoc } from 'firebase/firestore';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LegacyExtractionRecordV1, SessionUser } from '@klartext/bus-contract';
import {
  CURRENT_EXTRACTION_SCHEMA_VERSION,
  goldenFixtureMessages,
  legacyV1ExtractionFixtures,
  seededExtractionFixtures,
} from '@klartext/bus-contract';
import {
  createLinkedBusPair,
  createLoopbackGuestAdapter,
} from '@klartext/bus-contract/testing';
import { AuthService } from '../auth.service';
import { FirestoreDocumentRepository } from '../data/document-repository';
import { FirestoreExtractionRepository } from '../data/extraction-repository';
import { FirestoreFolderRepository } from '../data/folder-repository';
import { extractionRef } from '../data/paths';
import { DOCUMENT_REPOSITORY, EXTRACTION_REPOSITORY, FOLDER_REPOSITORY } from '../data/providers';
import { emulatorHost, type EmulatorHost } from '../data/testing';
import { UploadPipeline } from '../data/upload-pipeline';
import { LibraryStore } from '../library/library.store';
import { Reminders } from '../reminders/reminders';
import { ToastService } from '../toasts/toast.service';
import { BatchReanalysis } from './batch-reanalysis';
import { ExtractionFlow } from './extraction-flow';
import { HostBus } from './host-bus';
import { createHostBusAdapter, type HostBusAdapter } from './host-bus.adapter';
import { HostBusEvents } from './host-bus-events';

TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());

const STUB_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer;

/** The Firestore repository with its Storage stages stubbed (see header). */
class StubBytesDocumentRepository extends FirestoreDocumentRepository {
  override async getBytes(): Promise<ArrayBuffer> {
    return STUB_BYTES.slice(0);
  }

  protected override async deleteBytes(): Promise<void> {}
}

/** Polls `condition`, ticking Angular between checks. */
async function until(condition: () => boolean, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for condition');
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe('BatchReanalysis (emulator)', () => {
  let host: EmulatorHost;
  let documents: StubBytesDocumentRepository;
  let extractions: FirestoreExtractionRepository;
  let folders: FirestoreFolderRepository;
  let adapter: HostBusAdapter | undefined;
  let guestDispose: (() => void) | undefined;
  const createdDocs: string[] = [];
  const createdFolders: string[] = [];

  beforeEach(async () => {
    host = await emulatorHost();
    documents = new StubBytesDocumentRepository(host.firestore, host.storage, host.uid);
    extractions = new FirestoreExtractionRepository(host.firestore, host.uid);
    folders = new FirestoreFolderRepository(host.firestore, host.uid);
  });

  afterEach(async () => {
    TestBed.resetTestingModule();
    adapter?.dispose();
    guestDispose?.();
    for (const id of createdDocs) await documents.delete(id).catch(() => undefined);
    for (const id of createdFolders) await folders.delete(id).catch(() => undefined);
    createdDocs.length = 0;
    createdFolders.length = 0;
  });

  /** A ready Document in `folderId` whose stored Extraction is `schemaVersion: 1`. */
  async function seedOutdated(folderId: string, title: string): Promise<string> {
    const record = await documents.create({
      title,
      originalFilename: `${title}.pdf`,
      sizeBytes: STUB_BYTES.byteLength,
      folderId,
    });
    createdDocs.push(record.id);
    await documents.setStatus(record.id, 'ready');
    const legacy: Omit<LegacyExtractionRecordV1, 'createdAt'> = {
      ...legacyV1ExtractionFixtures['doc-versicherungsschein']!,
      documentId: record.id,
    };
    await setDoc(extractionRef(host.firestore, host.uid, record.id), {
      ...legacy,
      createdAt: new Date(),
    });
    return record.id;
  }

  function start() {
    const user: SessionUser = { uid: host.uid, displayName: 'Integration', email: null };
    TestBed.configureTestingModule({
      providers: [
        { provide: DOCUMENT_REPOSITORY, useValue: documents },
        { provide: FOLDER_REPOSITORY, useValue: folders },
        { provide: EXTRACTION_REPOSITORY, useValue: extractions },
        { provide: UploadPipeline, useFactory: () => new UploadPipeline(documents) },
        {
          provide: AuthService,
          useValue: { user: signal(user), idToken: vi.fn(async () => 'id-token') },
        },
        {
          provide: Router,
          useValue: {
            events: NEVER,
            routerState: { snapshot: { root: { firstChild: null } } },
            navigate: vi.fn(async () => true),
          },
        },
        HostBusEvents,
        LibraryStore,
        Reminders,
        ExtractionFlow,
        BatchReanalysis,
      ],
    });

    const pair = createLinkedBusPair();
    const hostOrigin = 'http://localhost:4200';
    const guestOrigin = 'http://localhost:5173';
    adapter = createHostBusAdapter({
      ...pair.host,
      peerOrigin: guestOrigin,
      probe: TestBed.inject(HostBusEvents),
    });
    TestBed.inject(HostBus).attach(adapter);
    const guest = createLoopbackGuestAdapter({
      ...pair.guest,
      peerOrigin: hostOrigin,
      probe: {
        sessionApplied: () => {},
        presentationApplied: () => {},
        actionItemStatesApplied: () => {},
      },
      // Mirrors the fake AI provider: a fixture per seeded id, else the golden one.
      runJob: async ({ document }) => ({
        ...(seededExtractionFixtures[document.documentId] ??
          goldenFixtureMessages.AI_PROCESSING_SUCCESS.payload.extraction),
        documentId: document.documentId,
      }),
    });
    guestDispose = () => guest.dispose();
    TestBed.inject(ExtractionFlow);
    guest.mount();
    return { batch: TestBed.inject(BatchReanalysis), toasts: TestBed.inject(ToastService) };
  }

  it('upgrades every Outdated Extraction in the Folder to the current schema', async () => {
    const folder = await folders.create({ name: 'Batch re-analysis', parentId: null });
    createdFolders.push(folder.id);
    const ids = [
      await seedOutdated(folder.id, 'Haftpflicht'),
      await seedOutdated(folder.id, 'Hausrat'),
    ];
    const { batch, toasts } = start();
    const candidates = batch.candidates(folder.id);
    await until(() => candidates()?.outdated.length === ids.length);

    expect(batch.start(folder.id, 'outdated')).toBe(true);
    await until(() => !batch.progress().running);

    for (const id of ids) {
      expect((await extractions.get(id))?.schemaVersion).toBe(CURRENT_EXTRACTION_SCHEMA_VERSION);
    }
    expect(CURRENT_EXTRACTION_SCHEMA_VERSION).toBe(2);
    expect(toasts.toasts().map((t) => t.title)).toContain('Re-analyzed 2 documents');
    await until(() => candidates()?.outdated.length === 0);
  });
});
