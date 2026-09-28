import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import type { DocumentRecord, DocumentStatus } from '../data/document';
import { DocumentTile, type TileAction } from './document-tile';

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

async function setup(doc: DocumentRecord, inputs: Record<string, unknown> = {}) {
  await TestBed.configureTestingModule({ imports: [DocumentTile] }).compileComponents();
  const fixture = TestBed.createComponent(DocumentTile);
  fixture.componentRef.setInput('doc', doc);
  for (const [key, value] of Object.entries(inputs)) fixture.componentRef.setInput(key, value);
  fixture.detectChanges();
  return fixture;
}

function menuItems(fixture: ComponentFixture<DocumentTile>): string[] {
  const el = fixture.nativeElement as HTMLElement;
  return [...el.querySelectorAll('.menu-item')].map((b) => b.textContent!.trim());
}

function openMenu(fixture: ComponentFixture<DocumentTile>): void {
  (fixture.nativeElement.querySelector('.tile-more') as HTMLButtonElement).click();
  fixture.detectChanges();
}

describe('DocumentTile — per-state contract (issue #16)', () => {
  it('uploading: progress bar in place of chips, ⋮ offers Cancel upload, not openable', async () => {
    const fixture = await setup(record('uploading'), { progress: 0.5 });
    const el = fixture.nativeElement as HTMLElement;
    const opened = vi.fn();
    fixture.componentInstance.opened.subscribe(opened);

    expect(el.querySelector('.progress')).toBeTruthy();
    expect((el.querySelector('.progress span') as HTMLElement).style.width).toBe('50%');
    expect(el.querySelector('.tile-warn')).toBeNull();
    expect(el.getAttribute('role')).toBeNull();

    openMenu(fixture);
    expect(menuItems(fixture)).toEqual(['Cancel upload']);

    el.click();
    expect(opened).not.toHaveBeenCalled();
  });

  it('ready: normal tile with the extraction chip slot and the full ⋮ menu', async () => {
    const fixture = await setup(record('ready'));
    const el = fixture.nativeElement as HTMLElement;
    const opened = vi.fn();
    fixture.componentInstance.opened.subscribe(opened);

    expect(el.querySelector('.tile-chips')).toBeTruthy();
    expect(el.querySelector('.progress')).toBeNull();

    el.click();
    expect(opened).toHaveBeenCalledOnce();

    openMenu(fixture);
    expect(menuItems(fixture)).toEqual(['Rename', 'Move to…', 'Download', 'Delete']);
    expect(el.querySelector('.menu-sep')).toBeTruthy();
  });

  it('failed: warning chip; ⋮ offers Retry upload while the File is held', async () => {
    const fixture = await setup(record('failed'), { canRetry: true });
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelector('.tile-warn')?.textContent).toContain('Upload failed');
    openMenu(fixture);
    expect(menuItems(fixture)).toEqual(['Retry upload']);
  });

  it('failed without a held File (post-reload): ⋮ offers Remove only', async () => {
    const fixture = await setup(record('failed'), { canRetry: false });
    openMenu(fixture);
    expect(menuItems(fixture)).toEqual(['Remove']);
  });

  it('dropping a file on a failed tile emits it for drop-to-retry', async () => {
    const fixture = await setup(record('failed'));
    const dropped = vi.fn();
    fixture.componentInstance.dropped.subscribe(dropped);
    const file = new File([new Uint8Array(4)], 'scan.pdf', { type: 'application/pdf' });

    const event = new Event('drop', { bubbles: true, cancelable: true });
    Object.assign(event, { dataTransfer: { files: [file] } });
    (fixture.nativeElement).dispatchEvent(event);

    expect(dropped).toHaveBeenCalledWith([file]);
  });

  it('deleting: spinner and no ⋮ — a failed delete offers Retry delete', async () => {
    const fixture = await setup(record('deleting'));
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.spinner')).toBeTruthy();
    expect(el.textContent).toContain('Deleting…');
    expect(el.querySelector('.tile-more')).toBeNull();

    fixture.componentRef.setInput('deleteFailed', true);
    fixture.detectChanges();
    openMenu(fixture);
    expect(menuItems(fixture)).toEqual(['Retry delete']);
  });

  it('menu item clicks emit the action; the shield closes the menu', async () => {
    const fixture = await setup(record('ready'));
    const el = fixture.nativeElement as HTMLElement;
    const actions: TileAction[] = [];
    fixture.componentInstance.action.subscribe((a: TileAction) => actions.push(a));

    openMenu(fixture);
    const rename = [...el.querySelectorAll<HTMLButtonElement>('.menu-item')].find((b) =>
      b.textContent!.includes('Rename'),
    )!;
    rename.click();
    fixture.detectChanges();
    expect(actions).toEqual(['rename']);
    expect(el.querySelector('.menu')).toBeNull();
  });
});
