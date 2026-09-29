import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import type { DocumentRecord, DocumentStatus } from '../data/document';
import { ExtractionFlow } from '../bus/extraction-flow';
import { DOCUMENT_REPOSITORY } from '../data/providers';
import { OpenDocument } from '../open-document';
import { PDF_ENGINE } from '../reader/pdf-engine';
import { Library } from './library';
import { LibraryStore } from './library.store';

function record(status: DocumentStatus, overrides: Partial<DocumentRecord> = {}): DocumentRecord {
  return {
    id: 'doc-1',
    ownerId: 'owner',
    title: 'Mietvertrag 2024',
    originalFilename: 'mietvertrag-2024.pdf',
    contentType: 'application/pdf',
    sizeBytes: 1234,
    storagePath: 'users/owner/documents/doc-1.pdf',
    status,
    folderId: null,
    createdAt: { seconds: 1_700_000_000, nanoseconds: 0 },
    updatedAt: { seconds: 1_700_000_000, nanoseconds: 0 },
    ...overrides,
  };
}

class FakeStore {
  readonly documents = signal<DocumentRecord[] | null>([]);
  readonly folders = signal<never[]>([]);
  readonly visible = signal<DocumentRecord[] | null>([]);
  readonly visibleFolders = signal<never[]>([]);
  readonly failedFolderDeletes = signal<ReadonlySet<string>>(new Set());
  readonly tree = signal({ folders: [], documents: [] });
  folderNode = vi.fn(() => undefined);
  nameTaken = vi.fn(() => false);
  moveBlockedIds = vi.fn(() => new Set<string>());
  dropItem = vi.fn(async () => {});
  createFolder = vi.fn(async () => true);
  renameFolder = vi.fn(async () => true);
  moveFolder = vi.fn(async () => true);
  deleteFolder = vi.fn(async () => {});
  retryFolderDelete = vi.fn(async () => {});
  readonly progress = signal<ReadonlyMap<string, number>>(new Map());
  readonly failedDeletes = signal<ReadonlySet<string>>(new Set());
  readonly extractionJobs = signal<ReadonlyMap<string, 'queued' | 'running' | 'failed'>>(new Map());
  readonly extractionStored = signal<ReadonlySet<string>>(new Set());
  readonly openDoc = signal<DocumentRecord | null>(null);
  folderById = vi.fn(() => undefined);
  ancestryOf = vi.fn(() => []);
  uploadFiles = vi.fn();
  cancelUpload = vi.fn();
  canRetryUpload = vi.fn(() => false);
  retryUpload = vi.fn();
  retryWithFile = vi.fn();
  removeFailed = vi.fn(async () => {});
  rename = vi.fn(async () => {});
  move = vi.fn(async () => {});
  download = vi.fn(async () => {});
  confirmDelete = vi.fn(async () => {});
  retryDelete = vi.fn(async () => {});
  open = vi.fn();
  close = vi.fn();
}

class FakeOpenDocument {
  readonly docId = signal<string | null>(null);
  readonly folderId = signal<string | null>(null);
  open = vi.fn();
  openFolder = vi.fn();
  close = vi.fn();
}

const fakePdfEngine = {
  load: vi.fn(async () => ({
    numPages: 1,
    page: async () => ({ width: 100, height: 100, render: async () => {} }),
    destroy: () => {},
  })),
};

const fakeRepository = { getBytes: vi.fn(async () => new ArrayBuffer(4)) };

async function setup() {
  const store = new FakeStore();
  const openDocument = new FakeOpenDocument();
  const flow = { retryRequested: vi.fn(() => true) };
  Object.assign(URL, {
    createObjectURL: vi.fn(() => 'blob:fake'),
    revokeObjectURL: vi.fn(),
  });
  await TestBed.configureTestingModule({
    imports: [Library],
    providers: [
      { provide: OpenDocument, useValue: openDocument },
      { provide: PDF_ENGINE, useValue: fakePdfEngine },
      { provide: DOCUMENT_REPOSITORY, useValue: fakeRepository },
    ],
  })
    .overrideComponent(Library, {
      set: {
        providers: [
          { provide: LibraryStore, useValue: store },
          { provide: ExtractionFlow, useValue: flow },
        ],
      },
    })
    .compileComponents();
  const fixture = TestBed.createComponent(Library);
  fixture.detectChanges();
  return { fixture, store, openDocument, flow, el: fixture.nativeElement as HTMLElement };
}

function dropFiles(el: Element, files: File[]): void {
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.assign(event, { dataTransfer: { files } });
  el.dispatchEvent(event);
}

function tileAction(
  fixture: ComponentFixture<Library>,
  tile: Element,
  label: string,
): void {
  (tile.querySelector('.tile-more') as HTMLButtonElement).click();
  fixture.detectChanges();
  const item = [...tile.querySelectorAll<HTMLButtonElement>('.menu-item')].find((b) =>
    b.textContent!.includes(label),
  )!;
  item.click();
  fixture.detectChanges();
}

describe('Library', () => {
  it('shows the empty library state with an upload affordance and drop hint', async () => {
    const { el } = await setup();
    expect(el.textContent).toContain('No documents yet');
    expect(el.textContent).toContain('Upload your first document');
    expect(el.textContent).toContain('drop');
    expect(el.querySelector('.grid')).toBeNull();
  });

  it('shows a spinner until the first snapshot lands', async () => {
    const { fixture, store, el } = await setup();
    store.documents.set(null);
    store.visible.set(null);
    fixture.detectChanges();
    expect(el.querySelector('[role="status"]')).toBeTruthy();
    expect(el.textContent).not.toContain('No documents yet');
  });

  it('renders a tile per Document', async () => {
    const { fixture, store, el } = await setup();
    const docs = [record('ready'), record('failed', { id: 'doc-2', title: 'Scan' })];
    store.documents.set(docs);
    store.visible.set(docs);
    fixture.detectChanges();
    expect(el.querySelectorAll('app-document-tile')).toHaveLength(2);
    expect(el.querySelector('.meta-line')?.textContent).toContain('2 documents');
  });

  it('opens the upload dialog; picking files uploads and closes it', async () => {
    const { fixture, store, el } = await setup();
    const upload = [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent!.includes('Upload'),
    )!;
    upload.click();
    fixture.detectChanges();
    expect(el.querySelector('app-upload-dialog')).toBeTruthy();

    const file = new File([new Uint8Array(4)], 'a.pdf', { type: 'application/pdf' });
    dropFiles(el.querySelector('.drop-zone')!, [file]);
    fixture.detectChanges();

    expect(store.uploadFiles).toHaveBeenCalledWith([file], null);
    expect(el.querySelector('app-upload-dialog')).toBeNull();
  });

  it('files dropped on the grid upload into the library', async () => {
    const { fixture, store, el } = await setup();
    const docs = [record('ready')];
    store.documents.set(docs);
    store.visible.set(docs);
    fixture.detectChanges();
    const file = new File([new Uint8Array(4)], 'a.pdf', { type: 'application/pdf' });

    dropFiles(el.querySelector('.library-drop')!, [file]);
    expect(store.uploadFiles).toHaveBeenCalledWith([file]);
  });

  it('⋮ → Rename opens the dialog; saving renames via the store', async () => {
    const { fixture, store, el } = await setup();
    const docs = [record('ready')];
    store.documents.set(docs);
    store.visible.set(docs);
    fixture.detectChanges();
    tileAction(fixture, el.querySelector('app-document-tile')!, 'Rename');

    const input = el.querySelector<HTMLInputElement>('[data-testid="rename-input"]')!;
    expect(input.value).toBe('Mietvertrag 2024');
    input.value = 'New name';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (el.querySelector('app-rename-dialog .btn-primary') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(store.rename).toHaveBeenCalledWith('doc-1', 'New name');
    expect(el.querySelector('app-rename-dialog')).toBeNull();
  });

  it('⋮ → Delete confirms with the decided copy, then tears down via the store', async () => {
    const { fixture, store, el } = await setup();
    const docs = [record('ready')];
    store.documents.set(docs);
    store.visible.set(docs);
    fixture.detectChanges();
    tileAction(fixture, el.querySelector('app-document-tile')!, 'Delete');

    expect(el.querySelector('app-delete-dialog')?.textContent).toContain(
      'Delete Mietvertrag 2024? This permanently removes the PDF and its plain-English summary.',
    );

    (el.querySelector('app-delete-dialog .btn-danger') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(store.confirmDelete).toHaveBeenCalledWith('doc-1');
    expect(el.querySelector('app-delete-dialog')).toBeNull();
  });

  it('⋮ → Move to… opens the tree picker and moves via the store', async () => {
    const { fixture, store, el } = await setup();
    const docs = [record('ready')];
    store.documents.set(docs);
    store.visible.set(docs);
    fixture.detectChanges();
    tileAction(fixture, el.querySelector('app-document-tile')!, 'Move to…');

    expect(el.querySelector('app-move-dialog [data-testid="folder-picker"]')?.textContent).toContain(
      'Documents',
    );

    (el.querySelector('app-move-dialog .btn-primary') as HTMLButtonElement).click();
    expect(store.move).toHaveBeenCalledWith('doc-1', null);
  });

  it('routes tile actions to the store and drop-to-retry to retryWithFile', async () => {
    const { fixture, store, el } = await setup();
    const docs = [
      record('failed', { id: 'doc-2', title: 'Scan' }),
      record('uploading', { id: 'doc-3', title: 'Incoming' }),
    ];
    store.documents.set(docs);
    store.visible.set(docs);
    fixture.detectChanges();

    const tiles = el.querySelectorAll('app-document-tile');
    tileAction(fixture, tiles[0]!, 'Remove');
    expect(store.removeFailed).toHaveBeenCalledWith('doc-2');

    const file = new File([new Uint8Array(4)], 'x.pdf', { type: 'application/pdf' });
    dropFiles(tiles[0]!, [file]);
    expect(store.retryWithFile).toHaveBeenCalledWith('doc-2', file);

    tileAction(fixture, tiles[1]!, 'Cancel upload');
    expect(store.cancelUpload).toHaveBeenCalledWith('doc-3');
  });

  it('an open Document swaps to the reader with a way back', async () => {
    const { fixture, store, openDocument, el } = await setup();
    const doc = record('ready');
    store.documents.set([doc]);
    store.visible.set([doc]);
    store.openDoc.set(doc);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(el.querySelector('app-reader .reader')).toBeTruthy();
    expect(el.querySelector('.title-doc')?.textContent).toContain('Mietvertrag 2024');
    expect(el.querySelector('app-pdf-viewer')).toBeTruthy();
    expect(el.querySelector('.insights-slot')).toBeTruthy();
    expect(el.querySelector('.grid')).toBeNull();

    (el.querySelector('.back-btn') as HTMLButtonElement).click();
    expect(openDocument.close).toHaveBeenCalledWith(null);
  });

  it('clicking a ready tile opens the Document', async () => {
    const { fixture, store, el } = await setup();
    const docs = [record('ready')];
    store.documents.set(docs);
    store.visible.set(docs);
    fixture.detectChanges();
    (el.querySelector('app-document-tile') as HTMLElement).click();
    expect(store.open).toHaveBeenCalledWith('doc-1');
  });

  // The extraction chip wiring (issue #32): the store's job state and stored
  // ids reach the tiles, and ⋮ Retry analysis routes to the flow's retry.

  it('renders the store job state as the tile chip and routes Retry analysis to the flow', async () => {
    const { fixture, store, flow, el } = await setup();
    const docs = [record('ready')];
    store.documents.set(docs);
    store.visible.set(docs);
    store.extractionJobs.set(new Map([['doc-1', 'failed']]));
    fixture.detectChanges();

    const tile = el.querySelector('app-document-tile')!;
    expect(tile.textContent).toContain("Couldn't analyze");

    tileAction(fixture, tile, 'Retry analysis');
    expect(flow.retryRequested).toHaveBeenCalledWith('doc-1');
  });

  it('renders no failure chip for a Document with a stored Extraction and a failed job', async () => {
    const { fixture, store, el } = await setup();
    const docs = [record('ready')];
    store.documents.set(docs);
    store.visible.set(docs);
    store.extractionJobs.set(new Map([['doc-1', 'failed']]));
    store.extractionStored.set(new Set(['doc-1']));
    fixture.detectChanges();

    const tile = el.querySelector('app-document-tile')!;
    expect(tile.textContent).not.toContain("Couldn't analyze");
    expect(tile.querySelector('.tile-chip')).toBeNull();
  });
});
