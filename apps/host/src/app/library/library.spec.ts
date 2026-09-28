import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import type { DocumentRecord, DocumentStatus } from '../data/document';
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
  readonly progress = signal<ReadonlyMap<string, number>>(new Map());
  readonly failedDeletes = signal<ReadonlySet<string>>(new Set());
  readonly openDoc = signal<DocumentRecord | null>(null);
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

async function setup() {
  const store = new FakeStore();
  await TestBed.configureTestingModule({ imports: [Library] })
    .overrideComponent(Library, {
      set: { providers: [{ provide: LibraryStore, useValue: store }] },
    })
    .compileComponents();
  const fixture = TestBed.createComponent(Library);
  fixture.detectChanges();
  return { fixture, store, el: fixture.nativeElement as HTMLElement };
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
    fixture.detectChanges();
    expect(el.querySelector('[role="status"]')).toBeTruthy();
    expect(el.textContent).not.toContain('No documents yet');
  });

  it('renders a tile per Document', async () => {
    const { fixture, store, el } = await setup();
    store.documents.set([record('ready'), record('failed', { id: 'doc-2', title: 'Scan' })]);
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

    expect(store.uploadFiles).toHaveBeenCalledWith([file]);
    expect(el.querySelector('app-upload-dialog')).toBeNull();
  });

  it('files dropped on the grid upload into the library', async () => {
    const { fixture, store, el } = await setup();
    store.documents.set([record('ready')]);
    fixture.detectChanges();
    const file = new File([new Uint8Array(4)], 'a.pdf', { type: 'application/pdf' });

    dropFiles(el.querySelector('.library-drop')!, [file]);
    expect(store.uploadFiles).toHaveBeenCalledWith([file]);
  });

  it('⋮ → Rename opens the dialog; saving renames via the store', async () => {
    const { fixture, store, el } = await setup();
    store.documents.set([record('ready')]);
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
    store.documents.set([record('ready')]);
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

  it('⋮ → Move to… opens the placeholder destination and moves via the store', async () => {
    const { fixture, store, el } = await setup();
    store.documents.set([record('ready')]);
    fixture.detectChanges();
    tileAction(fixture, el.querySelector('app-document-tile')!, 'Move to…');

    const select = el.querySelector<HTMLSelectElement>('[data-testid="destination"]')!;
    expect(select.disabled).toBe(true);
    expect(select.textContent).toContain('Documents');

    (el.querySelector('app-move-dialog .btn-primary') as HTMLButtonElement).click();
    expect(store.move).toHaveBeenCalledWith('doc-1', null);
  });

  it('routes tile actions to the store and drop-to-retry to retryWithFile', async () => {
    const { fixture, store, el } = await setup();
    store.documents.set([
      record('failed', { id: 'doc-2', title: 'Scan' }),
      record('uploading', { id: 'doc-3', title: 'Incoming' }),
    ]);
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

  it('an open Document swaps to the reader placeholder with a way back', async () => {
    const { fixture, store, el } = await setup();
    const doc = record('ready');
    store.documents.set([doc]);
    store.openDoc.set(doc);
    fixture.detectChanges();

    expect(el.querySelector('.reader')).toBeTruthy();
    expect(el.querySelector('.reader-title')?.textContent).toContain('Mietvertrag 2024');
    expect(el.querySelector('.insights-slot')).toBeTruthy();
    expect(el.querySelector('.grid')).toBeNull();

    (el.querySelector('.back-btn') as HTMLButtonElement).click();
    expect(store.close).toHaveBeenCalled();
  });

  it('clicking a ready tile opens the Document', async () => {
    const { fixture, store, el } = await setup();
    store.documents.set([record('ready')]);
    fixture.detectChanges();
    (el.querySelector('app-document-tile') as HTMLElement).click();
    expect(store.open).toHaveBeenCalledWith('doc-1');
  });
});
