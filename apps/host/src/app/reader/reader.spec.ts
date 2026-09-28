import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import type { DocumentRecord } from '../data/document';
import { DOCUMENT_REPOSITORY } from '../data/providers';
import { LibraryStore } from '../library/library.store';
import { OpenDocument } from '../open-document';
import { PDF_ENGINE, type PdfDocumentRef, type PdfEngine, type PdfPageRef } from './pdf-engine';
import { Reader } from './reader';

function record(id: string, title: string, overrides: Partial<DocumentRecord> = {}): DocumentRecord {
  return {
    id,
    ownerId: 'owner',
    title,
    originalFilename: `${id}.pdf`,
    contentType: 'application/pdf',
    sizeBytes: 1,
    storagePath: `users/owner/documents/${id}.pdf`,
    status: 'ready',
    folderId: null,
    createdAt: { seconds: 1, nanoseconds: 0 },
    updatedAt: { seconds: 1, nanoseconds: 0 },
    ...overrides,
  };
}

const FOLDERS = [
  { id: 'vertraege', name: 'Verträge', parentId: null, status: 'ready' as const },
  { id: 'wohnung', name: 'Wohnung', parentId: 'vertraege', status: 'ready' as const },
];

class FakePage implements PdfPageRef {
  readonly width = 600;
  readonly height = 800;
  async render(): Promise<void> {}
}

class FakeDoc implements PdfDocumentRef {
  readonly numPages = 4;
  async page(): Promise<PdfPageRef> {
    return new FakePage();
  }
  destroy(): void {}
}

const fakeEngine: PdfEngine = {
  load: vi.fn(async () => new FakeDoc()),
};

class FakeStore {
  readonly documents = signal<DocumentRecord[]>([]);
  readonly folders = signal(FOLDERS);
  folderById(id: string | null) {
    return this.folders().find((f) => f.id === id);
  }
  ancestryOf(id: string | null) {
    if (id === 'wohnung') return [FOLDERS[0]!, FOLDERS[1]!];
    return id === 'vertraege' ? [FOLDERS[0]!] : [];
  }
  open = vi.fn();
}

class FakeOpenDocument {
  readonly docId = signal<string | null>(null);
  readonly folderId = signal<string | null>(null);
  open = vi.fn();
  openFolder = vi.fn();
  close = vi.fn();
}

async function setup(doc: DocumentRecord, siblings: DocumentRecord[] = []) {
  const store = new FakeStore();
  store.documents.set(siblings);
  const openDocument = new FakeOpenDocument();
  Object.assign(URL, {
    createObjectURL: vi.fn(() => 'blob:fake'),
    revokeObjectURL: vi.fn(),
  });
  await TestBed.configureTestingModule({
    imports: [Reader],
    providers: [
      { provide: LibraryStore, useValue: store },
      { provide: OpenDocument, useValue: openDocument },
      { provide: PDF_ENGINE, useValue: fakeEngine },
      { provide: DOCUMENT_REPOSITORY, useValue: { getBytes: vi.fn(async () => new ArrayBuffer(4)) } },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(Reader);
  fixture.componentRef.setInput('doc', doc);
  fixture.detectChanges();
  for (let i = 0; i < 20; i++) await Promise.resolve();
  fixture.detectChanges();
  return { fixture, store, openDocument, el: fixture.nativeElement as HTMLElement };
}

function backButton(el: HTMLElement): HTMLButtonElement {
  return el.querySelector<HTMLButtonElement>('.back-btn')!;
}

describe('Reader (issue #29)', () => {
  it('renders the split view: PDF pane plus the insights slot', async () => {
    const { el } = await setup(record('d1', 'Mietvertrag 2024'));
    expect(el.querySelector('app-pdf-viewer')).toBeTruthy();
    expect(el.querySelector('canvas')).toBeTruthy();
    expect(el.querySelector('.insights-slot')).toBeTruthy();
  });

  it('backs out to the root Folder label for a root Document', async () => {
    const { el, openDocument } = await setup(record('d1', 'Brief', { folderId: null }));
    expect(backButton(el).textContent).toContain('Documents');
    backButton(el).click();
    expect(openDocument.close).toHaveBeenCalledWith(null);
  });

  it('backs out to the parent Folder name for a filed Document', async () => {
    const { el, openDocument } = await setup(record('d1', 'Mietvertrag', { folderId: 'wohnung' }));
    expect(backButton(el).textContent).toContain('Wohnung');
    backButton(el).click();
    expect(openDocument.close).toHaveBeenCalledWith('wohnung');
  });

  it('the title opens a macOS-style path menu down to the root', async () => {
    const { el, fixture, openDocument } = await setup(
      record('d1', 'Mietvertrag 2024', { folderId: 'wohnung' }),
    );
    (el.querySelector<HTMLButtonElement>('.path-title-btn'))!.click();
    fixture.detectChanges();

    const menu = el.querySelector('.path-menu');
    expect(menu).toBeTruthy();
    expect(menu!.querySelector('.is-current')!.textContent).toContain('Mietvertrag 2024');
    const items = [...menu!.querySelectorAll<HTMLButtonElement>('button.menu-item')].map((b) =>
      b.textContent!.trim(),
    );
    expect(items).toEqual(['Wohnung', 'Verträge', 'Documents']);

    [...menu!.querySelectorAll<HTMLButtonElement>('button.menu-item')][2]!.click();
    expect(openDocument.openFolder).toHaveBeenCalledWith(null);
  });

  it('walks sibling Documents with the ‹ n of m › stepper', async () => {
    const a = record('a', 'Anmeldung');
    const me = record('me', 'Mietvertrag');
    const z = record('z', 'Zusage');
    const { el, store } = await setup(me, [a, me, z]);

    const stepper = el.querySelector('.stepper');
    expect(stepper?.textContent).toContain('2 of 3');

    const [prev, next] = [...stepper!.querySelectorAll<HTMLButtonElement>('button')];
    expect(prev!.disabled).toBe(false);
    next!.click();
    expect(store.open).toHaveBeenCalledWith('z');
  });

  it('hides the stepper for a Document without siblings', async () => {
    const doc = record('only', 'Allein');
    const { el } = await setup(doc, [doc]);
    expect(el.querySelector('.stepper')).toBeNull();
  });

  it('exposes goToPage, forwarded to the viewer for the Session layer', async () => {
    const { fixture, el } = await setup(record('d1', 'Brief'));
    fixture.componentInstance.goToPage(2);
    for (let i = 0; i < 20; i++) await Promise.resolve();
    fixture.detectChanges();
    expect(el.querySelector('canvas')?.getAttribute('aria-label')).toBe('Page 2 of 4');
  });
});
