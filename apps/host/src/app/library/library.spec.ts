import type { ExtractionRecord } from '@klartext/bus-contract';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import type { DocumentRecord, DocumentStatus } from '../data/document';
import type { FolderRecord } from '../data/folder';
import { ExtractionFlow } from '../bus/extraction-flow';
import { DOCUMENT_REPOSITORY } from '../data/providers';
import { OpenDocument } from '../open-document';
import { PDF_ENGINE } from '../reader/pdf-engine';
import { Reminders } from '../reminders/reminders';
import { Library } from './library';
import { LibraryStore } from './library.store';
import { menuOverflowingViewport } from '../menu-viewport.spec-support';

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

function folder(id: string, name: string, parentId: string | null): FolderRecord {
  return {
    id,
    name,
    parentId,
    status: 'ready',
    createdAt: { seconds: 1_700_000_000, nanoseconds: 0 },
    updatedAt: { seconds: 1_700_000_000, nanoseconds: 0 },
  };
}

class FakeStore {
  readonly documents = signal<DocumentRecord[] | null>([]);
  readonly folders = signal<FolderRecord[]>([]);
  readonly visible = signal<DocumentRecord[] | null>([]);
  readonly deepDocumentCount = signal(0);
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
  readonly extractionsByDocId = signal<ReadonlyMap<string, ExtractionRecord>>(new Map());
  readonly extractionsLoaded = signal(true);
  readonly openDoc = signal<DocumentRecord | null>(null);
  folderById = vi.fn(
    (id: string | null): FolderRecord | undefined =>
      this.folders().find((f) => f.id === id),
  );
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
  openAt = vi.fn();
  close = vi.fn();
}

class FakeOpenDocument {
  readonly docId = signal<string | null>(null);
  readonly folderId = signal<string | null>(null);
  readonly insightsLaneHidden = signal(false);
  readonly query = signal<string | null>(null);
  readonly searchScope = signal<'folder' | 'all'>('folder');
  readonly deepLink = signal<{ documentId: string; page: number | null; item: string | null } | null>(null);
  landDeepLink = vi.fn();
  deepLinkMissed = vi.fn();
  open = vi.fn();
  openFolder = vi.fn();
  close = vi.fn();
  toggleInsightsLane = vi.fn();
  search = vi.fn((q: string) => {
    this.query.set(q.trim() || null);
  });
  setSearchScope = vi.fn((scope: 'folder' | 'all') => {
    this.searchScope.set(scope);
  });
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
  const reminders = { draft: signal(null), open: vi.fn(), close: vi.fn() };
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
          { provide: Reminders, useValue: reminders },
        ],
      },
    })
    .compileComponents();
  const fixture = TestBed.createComponent(Library);
  fixture.detectChanges();
  return { fixture, store, openDocument, flow, reminders, el: fixture.nativeElement as HTMLElement };
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
    store.deepDocumentCount.set(2);
    fixture.detectChanges();
    expect(el.querySelectorAll('app-document-tile')).toHaveLength(2);
    expect(el.querySelector('.meta-line')?.textContent).toContain('2 documents');
  });

  // The meta-line's count is the scope's deep count (issue #64): Documents
  // nested inside the listed Folders count, not just the direct ones.
  it('the meta-line counts Documents nested inside Folders too', async () => {
    const { fixture, store, el } = await setup();
    store.visible.set([record('ready')]);
    store.deepDocumentCount.set(4);
    fixture.detectChanges();
    expect(el.querySelector('.meta-line')?.textContent).toContain('4 documents');
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
    expect(el.querySelector('.grid')).toBeNull();

    (el.querySelector('.back-btn') as HTMLButtonElement).click();
    expect(openDocument.close).toHaveBeenCalledWith(null);
  });

  it('makes room for the floating insights lane only while it shows', async () => {
    const { fixture, openDocument, el } = await setup();
    expect(el.classList.contains('reading')).toBe(false);
    expect(el.classList.contains('lane-open')).toBe(false);

    openDocument.docId.set('ready');
    fixture.detectChanges();
    expect(el.classList.contains('reading')).toBe(true);
    expect(el.classList.contains('lane-open')).toBe(true);

    openDocument.insightsLaneHidden.set(true);
    fixture.detectChanges();
    expect(el.classList.contains('reading')).toBe(true);
    expect(el.classList.contains('lane-open')).toBe(false);
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
    store.extractionsByDocId.set(new Map([['doc-1', {} as ExtractionRecord]]));
    fixture.detectChanges();

    const tile = el.querySelector('app-document-tile')!;
    expect(tile.textContent).not.toContain("Couldn't analyze");
    expect(tile.querySelector('.tile-chip')).toBeNull();
  });

  // Mobile push nav (issue #55): inside a Folder the toolbar offers ‹ parent —
  // the sidebar tree that desktop navigates with is hidden there.

  it('inside a nested Folder the back button names its parent and taps up to it', async () => {
    const { fixture, store, openDocument, el } = await setup();
    store.folders.set([
      folder('vertraege', 'Verträge', null),
      folder('wohnung', 'Wohnung', 'vertraege'),
    ]);
    openDocument.folderId.set('wohnung');
    fixture.detectChanges();

    const back = el.querySelector<HTMLButtonElement>('.back-btn')!;
    expect(back).toBeTruthy();
    expect(back.textContent).toContain('Verträge');
    expect(back.getAttribute('aria-label')).toContain('Verträge');

    back.click();
    expect(openDocument.openFolder).toHaveBeenCalledWith('vertraege');
  });

  it('inside a top-level Folder the back button goes up to Documents', async () => {
    const { fixture, store, openDocument, el } = await setup();
    store.folders.set([folder('vertraege', 'Verträge', null)]);
    openDocument.folderId.set('vertraege');
    fixture.detectChanges();

    const back = el.querySelector<HTMLButtonElement>('.back-btn')!;
    expect(back.textContent).toContain('Documents');

    back.click();
    expect(openDocument.openFolder).toHaveBeenCalledWith(null);
  });

  it('at root there is no back affordance', async () => {
    const { el } = await setup();
    expect(el.querySelector('.back-btn')).toBeNull();
  });

  it('shows no back affordance until the browsed Folder resolves', async () => {
    const { fixture, store, openDocument, el } = await setup();
    openDocument.folderId.set('late-folder');
    fixture.detectChanges();

    // folderById still returns undefined — offering ‹ Documents here would
    // skip a level once the real parent lands.
    expect(el.querySelector('.back-btn')).toBeNull();

    store.folders.set([folder('late-folder', 'Late', null)]);
    fixture.detectChanges();
    expect(el.querySelector('.back-btn')).toBeTruthy();
  });

  // The + affordance's add menu (issue #59): on phone widths the toolbar's two
  // creation verbs collapse into a single + that opens a menu — the standalone
  // New folder pill is desktop-only now.

  it('+ opens a menu offering Upload document and New folder', async () => {
    const { fixture, el } = await setup();
    (el.querySelector('.btn-add') as HTMLButtonElement).click();
    fixture.detectChanges();

    const items = [...el.querySelectorAll<HTMLElement>('.library-toolbar [role="menuitem"]')].map((i) =>
      i.textContent!.trim(),
    );
    expect(items).toEqual(['Upload document', 'New folder']);
  });

  it('add menu → Upload document opens the upload dialog and closes the menu', async () => {
    const { fixture, el } = await setup();
    (el.querySelector('.btn-add') as HTMLButtonElement).click();
    fixture.detectChanges();

    const item = [...el.querySelectorAll<HTMLElement>('.library-toolbar [role="menuitem"]')].find((i) =>
      i.textContent!.includes('Upload document'),
    )!;
    item.click();
    fixture.detectChanges();

    expect(el.querySelector('app-upload-dialog')).toBeTruthy();
    expect(el.querySelector('.library-toolbar [role="menu"]')).toBeNull();
  });

  it('add menu → New folder opens the folder-name dialog and closes the menu', async () => {
    const { fixture, el } = await setup();
    (el.querySelector('.btn-add') as HTMLButtonElement).click();
    fixture.detectChanges();

    const item = [...el.querySelectorAll<HTMLElement>('.library-toolbar [role="menuitem"]')].find((i) =>
      i.textContent!.includes('New folder'),
    )!;
    item.click();
    fixture.detectChanges();

    const dialog = el.querySelector('app-folder-name-dialog');
    expect(dialog?.textContent).toContain('New folder');
    expect(el.querySelector('.library-toolbar [role="menu"]')).toBeNull();
  });

  it('Escape and the shield dismiss the add menu without acting', async () => {
    const { fixture, el } = await setup();
    (el.querySelector('.btn-add') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('.library-toolbar [role="menu"]')).toBeTruthy();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(el.querySelector('.library-toolbar [role="menu"]')).toBeNull();
    expect(el.querySelector('app-upload-dialog')).toBeNull();

    (el.querySelector('.btn-add') as HTMLButtonElement).click();
    fixture.detectChanges();
    (el.querySelector('.menu-shield') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('.library-toolbar [role="menu"]')).toBeNull();
  });

  it('flips the add menu up when it would run off the visual viewport (issue #149)', async () => {
    const rectSpy = menuOverflowingViewport();
    try {
      const { fixture, el } = await setup();
      (el.querySelector('.btn-add') as HTMLButtonElement).click();
      fixture.detectChanges();
      const menu = el.querySelector('.library-toolbar [role="menu"]') as HTMLElement;
      expect(menu.classList.contains('is-up')).toBe(true);
    } finally {
      rectSpy.mockRestore();
    }
  });

  // Issue #120: the Folder attention overview above the tile grid.
  describe('Folder attention overview', () => {
    const extractionFor = (
      documentId: string,
      actionItems: ExtractionRecord['actionItems'],
    ): ExtractionRecord => ({
      documentId,
      schemaVersion: 2,
      promptVersion: 'klartext-extraction-v2',
      model: 'm',
      documentType: 'OTHER',
      sourceLanguage: 'de',
      plainEnglishSummary: 's',
      extractionStatus: 'COMPLETE',
      actionItems,
      keyTakeaways: [],
      createdAt: { seconds: 1, nanoseconds: 0 },
    });

    async function withAttention(extractionsLoaded = true) {
      const ctx = await setup();
      const docs = [
        record('ready', { id: 'd-top', title: 'Top letter', folderId: null }),
        record('ready', { id: 'd-deep', title: 'Mietvertrag', folderId: 'b' }),
        record('ready', { id: 'd-quiet', title: 'Quiet', folderId: null }),
      ];
      ctx.store.folders.set([folder('a', 'Wohnung', null), folder('b', 'Mietverträge', 'a')]);
      ctx.store.documents.set(docs);
      ctx.store.visible.set(docs.filter((d) => d.folderId === null));
      ctx.store.deepDocumentCount.set(3);
      ctx.store.extractionsLoaded.set(extractionsLoaded);
      ctx.store.extractionsByDocId.set(
        new Map([
          [
            'd-top',
            extractionFor('d-top', [
              { id: 'ai-1', text: 'Pay the fee', sourceQuote: 'Gebühr', page: 2, timing: { kind: 'FIXED_DATE', dueDate: '2000-01-01' } },
            ]),
          ],
          [
            'd-deep',
            extractionFor('d-deep', [
              { id: 'ai-2', text: 'Give notice in writing', sourceQuote: 'Schriftform', page: 3, timing: { kind: 'NONE' } },
            ]),
          ],
        ]),
      );
      ctx.fixture.detectChanges();
      return ctx;
    }

    const panel = (el: HTMLElement) => el.querySelector('app-attention-panel');

    const seeAll = (el: HTMLElement) =>
      [...panel(el)!.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent!.trim() === 'See All');

    it('lists the most urgent Action Items on the card with short timing and a total count', async () => {
      const { el } = await withAttention();
      const rows = [...panel(el)!.querySelectorAll('.attention-row')].map((r) => r.textContent!.trim());
      expect(rows).toEqual([expect.stringContaining('Pay the fee'), expect.stringContaining('Give notice in writing')]);
      expect(rows[0]).toContain('Overdue');
      expect(panel(el)!.querySelector('.attention-count')?.textContent).toBe('2');
    });

    it('See All opens the full list grouped by urgency with Document, deep path and page', async () => {
      const { fixture, el } = await withAttention();
      seeAll(el)!.click();
      fixture.detectChanges();
      const sheet = panel(el)!.querySelector('[role="dialog"]')!;
      expect([...sheet.querySelectorAll('h3')].map((h) => h.textContent!.trim())).toEqual(['Overdue', 'No date']);
      const deep = [...sheet.querySelectorAll('.sheet-row')].find((r) => r.textContent!.includes('Give notice in writing'))!;
      expect(deep.querySelector('.sheet-doc')!.textContent).toContain('Mietvertrag · Wohnung / Mietverträge');
      expect(deep.querySelector('.sheet-page')!.textContent).toBe('p. 3');
    });

    it('collapses and expands from the header', async () => {
      const { fixture, el } = await withAttention();
      const head = panel(el)!.querySelector<HTMLButtonElement>('.attention-toggle')!;
      expect(head.getAttribute('aria-expanded')).toBe('true');
      head.click();
      fixture.detectChanges();
      expect(head.getAttribute('aria-expanded')).toBe('false');
      expect(panel(el)!.querySelector('.attention-row')).toBeNull();
      expect(seeAll(el)).toBeUndefined();
    });

    it('clicking an item opens its Document at the cited page and quote', async () => {
      const { fixture, store, el } = await withAttention();
      const row = [...panel(el)!.querySelectorAll('.attention-row')].find((r) =>
        r.textContent!.includes('Give notice in writing'),
      )!;
      row.querySelector<HTMLButtonElement>('.attention-hit')!.click();
      fixture.detectChanges();
      expect(store.openAt).toHaveBeenCalledWith('d-deep', { page: 3, quote: 'Schriftform' });
    });

    // Issue #122: a row's Add reminder affordance routes to the Reminders
    // draft — never the Document open that the row itself performs.
    it('a row’s Add reminder affordance opens the Reminder draft, not the Document', async () => {
      const { fixture, store, reminders, el } = await withAttention();
      const row = [...panel(el)!.querySelectorAll('.attention-row')].find((r) =>
        r.textContent!.includes('Give notice in writing'),
      )!;
      row.querySelector<HTMLButtonElement>('.attention-remind')!.click();
      fixture.detectChanges();
      expect(reminders.open).toHaveBeenCalledWith('d-deep', 'ai-2');
      expect(store.openAt).not.toHaveBeenCalled();
    });

    it('the sheet’s Add reminder affordance closes the sheet and opens the draft', async () => {
      const { fixture, reminders, el } = await withAttention();
      seeAll(el)!.click();
      fixture.detectChanges();
      const row = [...panel(el)!.querySelectorAll('li')].find((r) =>
        r.textContent!.includes('Pay the fee'),
      )!;
      row.querySelector<HTMLButtonElement>('.sheet-remind')!.click();
      fixture.detectChanges();
      expect(reminders.open).toHaveBeenCalledWith('d-top', 'ai-1');
      expect(panel(el)!.querySelector('[role="dialog"]')).toBeNull();
    });

    it('clicking an item in the sheet closes it and opens the Document at the cited page', async () => {
      const { fixture, store, el } = await withAttention();
      seeAll(el)!.click();
      fixture.detectChanges();
      const row = [...panel(el)!.querySelectorAll<HTMLButtonElement>('.sheet-row')].find((r) =>
        r.textContent!.includes('Pay the fee'),
      )!;
      row.click();
      fixture.detectChanges();
      expect(store.openAt).toHaveBeenCalledWith('d-top', { page: 2, quote: 'Gebühr' });
      expect(panel(el)!.querySelector('[role="dialog"]')).toBeNull();
    });

    it('shows the empty state once every Extraction is read and nothing needs attention', async () => {
      const { fixture, store, el } = await withAttention();
      store.extractionsByDocId.set(new Map());
      fixture.detectChanges();
      expect(panel(el)!.textContent).toContain('Nothing needs your attention.');
    });

    it('shows "Reading n of m documents…" until the Extraction index has loaded', async () => {
      const { el } = await withAttention(false);
      expect(panel(el)!.textContent).toContain('Reading 2 of 3 documents…');
      expect(panel(el)!.textContent).not.toContain('Nothing needs your attention.');
    });

    it('is absent when the browsed scope holds no Documents', async () => {
      const { fixture, store, el } = await withAttention();
      store.deepDocumentCount.set(0);
      store.documents.set([]);
      fixture.detectChanges();
      expect(panel(el)).toBeNull();
    });
  });

  // Library search (issue #121): toolbar field → ?q= → inline results with
  // reason badges; item/quote matches open at the cited page via PageFocus.
  describe('search', () => {
    const searchExtraction = (documentId: string): ExtractionRecord => ({
      documentId,
      schemaVersion: 2,
      promptVersion: 'klartext-extraction-v2',
      model: 'm',
      documentType: 'OTHER',
      sourceLanguage: 'de',
      plainEnglishSummary: 's',
      extractionStatus: 'COMPLETE',
      actionItems: [
        {
          id: 'ai-1',
          text: 'Give three months notice',
          sourceQuote: 'Die Kündigungsfrist beträgt drei Monate.',
          page: 3,
          timing: { kind: 'NONE' },
        },
      ],
      keyTakeaways: [],
      createdAt: { seconds: 1, nanoseconds: 0 },
    });

    async function withLibrary() {
      const ctx = await setup();
      ctx.store.folders.set([
        folder('vertraege', 'Verträge', null),
        folder('wohnung', 'Wohnung', 'vertraege'),
      ]);
      ctx.store.documents.set([
        record('ready', { id: 'd-flat', title: 'Mietvertrag', folderId: 'wohnung' }),
        record('ready', { id: 'd-tax', title: 'Steuerbescheid', folderId: null }),
      ]);
      ctx.store.visible.set(ctx.store.documents());
      ctx.store.deepDocumentCount.set(2);
      ctx.store.extractionsByDocId.set(new Map([['d-flat', searchExtraction('d-flat')]]));
      ctx.fixture.detectChanges();
      return ctx;
    }

    const field = (el: HTMLElement) =>
      el.querySelector<HTMLInputElement>('.search-input')!;

    async function type(ctx: Awaited<ReturnType<typeof withLibrary>>, text: string) {
      const input = field(ctx.el);
      input.value = text;
      // The input debounces (issue #121) — run the clock through it.
      vi.useFakeTimers();
      input.dispatchEvent(new Event('input'));
      vi.advanceTimersByTime(250);
      vi.useRealTimers();
      ctx.fixture.detectChanges();
      await ctx.fixture.whenStable();
      ctx.fixture.detectChanges();
    }

    it('the toolbar field writes the query to ?q=', async () => {
      const ctx = await withLibrary();
      await type(ctx, 'kündigung');
      expect(ctx.openDocument.search).toHaveBeenCalledWith('kündigung');
    });

    it('an active query swaps the tile grid for inline results — Folders above Documents', async () => {
      const ctx = await withLibrary();
      ctx.openDocument.query.set('vertrag');
      ctx.fixture.detectChanges();

      expect(ctx.el.querySelector('.grid')).toBeNull();
      const results = ctx.el.querySelector('app-search-results')!;
      const sections = [...results.querySelectorAll('h2')].map((h) => h.textContent!.trim());
      expect(sections).toEqual(['Folders', 'Documents']);
      const rows = [...results.querySelectorAll('.result-row')].map((r) => r.textContent!);
      expect(rows[0]).toContain('Verträge');
      expect(rows[1]).toContain('Mietvertrag');
    });

    it('rows wear reason badges and the matched field as a snippet', async () => {
      const ctx = await withLibrary();
      ctx.openDocument.query.set('kündigungsfrist');
      ctx.fixture.detectChanges();

      const row = ctx.el.querySelector('app-search-results .result-row')!;
      expect(row.querySelector('.badge')!.textContent).toContain('Quote');
      expect(row.textContent).toContain('Die Kündigungsfrist beträgt drei Monate.');
      expect(row.textContent).toContain('Mietvertrag');
      expect(row.textContent).toContain('Verträge / Wohnung');
    });

    it('clicking an item/quote match opens the Document at the cited page', async () => {
      const ctx = await withLibrary();
      ctx.openDocument.query.set('kündigungsfrist');
      ctx.fixture.detectChanges();
      (ctx.el.querySelector('app-search-results .result-row') as HTMLElement).click();
      expect(ctx.store.openAt).toHaveBeenCalledWith('d-flat', {
        page: 3,
        quote: 'Die Kündigungsfrist beträgt drei Monate.',
      });
    });

    it('clicking a title match opens the Document plainly; a Folder row browses it', async () => {
      const ctx = await withLibrary();
      ctx.openDocument.query.set('mietvertrag');
      ctx.fixture.detectChanges();
      const row = ctx.el.querySelector('app-search-results .result-row') as HTMLElement;
      expect(row.textContent).toContain('Mietvertrag');
      row.click();
      expect(ctx.store.open).toHaveBeenCalledWith('d-flat');

      ctx.openDocument.query.set('wohnung');
      ctx.fixture.detectChanges();
      (ctx.el.querySelector('app-search-results .result-row') as HTMLElement).click();
      expect(ctx.openDocument.openFolder).toHaveBeenCalledWith('wohnung');
    });

    it('scopes to the browsed Folder by default and widens via the All documents pill', async () => {
      const ctx = await withLibrary();
      ctx.openDocument.folderId.set('vertraege');
      ctx.openDocument.query.set('steuer');
      ctx.fixture.detectChanges();

      // d-tax sits at root — outside Verträge — so the scoped search misses it.
      expect(ctx.el.textContent).toContain('No matches');

      const pill = [...ctx.el.querySelectorAll<HTMLButtonElement>('.scope-pill button')].find(
        (b) => b.textContent!.includes('All documents'),
      )!;
      pill.click();
      ctx.fixture.detectChanges();
      expect(ctx.el.querySelector('app-search-results')!.textContent).toContain('Steuerbescheid');
    });

    it('shows the scope pill only inside a Folder while searching', async () => {
      const ctx = await withLibrary();
      ctx.openDocument.query.set('steuer');
      ctx.fixture.detectChanges();
      expect(ctx.el.querySelector('.scope-pill')).toBeNull();

      ctx.openDocument.folderId.set('vertraege');
      ctx.fixture.detectChanges();
      expect(ctx.el.querySelector('.scope-pill')).toBeTruthy();
    });

    it('/ and Cmd/Ctrl+K focus the field', async () => {
      const ctx = await withLibrary();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: '/' }));
      ctx.fixture.detectChanges();
      expect(document.activeElement).toBe(field(ctx.el));

      (document.activeElement as HTMLElement).blur();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
      ctx.fixture.detectChanges();
      expect(document.activeElement).toBe(field(ctx.el));
    });

    it('/ does not steal focus from another field', async () => {
      const ctx = await withLibrary();
      const other = document.createElement('input');
      ctx.el.appendChild(other);
      other.focus();
      // A real keypress targets the focused element — the guard reads it.
      other.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true }));
      ctx.fixture.detectChanges();
      expect(document.activeElement).toBe(other);
    });

    it('Escape in the field clears the query', async () => {
      const ctx = await withLibrary();
      ctx.openDocument.query.set('xy');
      ctx.fixture.detectChanges();
      field(ctx.el).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect(ctx.openDocument.search).toHaveBeenCalledWith('');
    });

    it('the mobile magnifier reveals the field', async () => {
      const ctx = await withLibrary();
      expect(ctx.el.classList.contains('search-open')).toBe(false);
      (ctx.el.querySelector('.btn-search') as HTMLButtonElement).click();
      ctx.fixture.detectChanges();
      expect(ctx.el.classList.contains('search-open')).toBe(true);
    });

    it('navigation collapses the expanded field back to the magnifier', async () => {
      const ctx = await withLibrary();
      (ctx.el.querySelector('.btn-search') as HTMLButtonElement).click();
      ctx.fixture.detectChanges();
      expect(ctx.el.classList.contains('search-open')).toBe(true);

      ctx.openDocument.folderId.set('vertraege');
      ctx.fixture.detectChanges();
      expect(ctx.el.classList.contains('search-open')).toBe(false);

      (ctx.el.querySelector('.btn-search') as HTMLButtonElement).click();
      ctx.fixture.detectChanges();
      ctx.openDocument.docId.set('d-flat');
      ctx.fixture.detectChanges();
      expect(ctx.el.classList.contains('search-open')).toBe(false);
    });

    const blurFromSearch = (ctx: Awaited<ReturnType<typeof withLibrary>>, into: EventTarget | null) =>
      ctx.el.querySelector('.search')!.dispatchEvent(
        new FocusEvent('focusout', { bubbles: true, relatedTarget: into }),
      );

    it('focus leaving the empty field collapses it', async () => {
      const ctx = await withLibrary();
      (ctx.el.querySelector('.btn-search') as HTMLButtonElement).click();
      ctx.fixture.detectChanges();

      blurFromSearch(ctx, document.body);
      ctx.fixture.detectChanges();
      expect(ctx.el.classList.contains('search-open')).toBe(false);
    });

    it('focus moving within the field keeps it open — as does an active query', async () => {
      const ctx = await withLibrary();
      (ctx.el.querySelector('.btn-search') as HTMLButtonElement).click();
      ctx.fixture.detectChanges();

      blurFromSearch(ctx, field(ctx.el));
      ctx.fixture.detectChanges();
      expect(ctx.el.classList.contains('search-open')).toBe(true);

      ctx.openDocument.query.set('vertrag');
      ctx.fixture.detectChanges();
      blurFromSearch(ctx, document.body);
      ctx.fixture.detectChanges();
      // searching() holds the field — it is showing the active query.
      expect(ctx.el.classList.contains('search-open')).toBe(true);
    });

    it('the mobile close button collapses the empty field', async () => {
      const ctx = await withLibrary();
      (ctx.el.querySelector('.btn-search') as HTMLButtonElement).click();
      ctx.fixture.detectChanges();
      expect(ctx.el.classList.contains('search-open')).toBe(true);

      (ctx.el.querySelector('.search-close') as HTMLButtonElement).click();
      ctx.fixture.detectChanges();
      expect(ctx.el.classList.contains('search-open')).toBe(false);
    });

    it('the close button gives way to the clear button while searching', async () => {
      const ctx = await withLibrary();
      expect(ctx.el.querySelector('.search-close')).toBeTruthy();

      ctx.openDocument.query.set('vertrag');
      ctx.fixture.detectChanges();
      expect(ctx.el.querySelector('.search-close')).toBeNull();
      expect(ctx.el.querySelector('.search-clear')).toBeTruthy();
    });

    it('the open-but-idle field marks the host for the mobile prompt; a query clears it', async () => {
      const ctx = await withLibrary();
      expect(ctx.el.classList.contains('search-idle')).toBe(false);
      expect(ctx.el.querySelector('.search-prompt')).toBeTruthy();

      (ctx.el.querySelector('.btn-search') as HTMLButtonElement).click();
      ctx.fixture.detectChanges();
      expect(ctx.el.classList.contains('search-idle')).toBe(true);

      ctx.openDocument.query.set('vertrag');
      ctx.fixture.detectChanges();
      expect(ctx.el.classList.contains('search-idle')).toBe(false);
    });

    it('a query restored from the URL fills the field', async () => {
      const ctx = await withLibrary();
      ctx.openDocument.query.set('restored');
      ctx.fixture.detectChanges();
      expect(field(ctx.el).value).toBe('restored');
    });
  });
});
