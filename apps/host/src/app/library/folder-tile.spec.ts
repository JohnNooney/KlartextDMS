import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import type { FolderRecord } from '../data/folder';
import { DRAG_MIME, type DragItem } from './folder-drag';
import { FolderTile, type FolderTileAction } from './folder-tile';

const ts = { seconds: 1_700_000_000, nanoseconds: 0 };

function folder(status: FolderRecord['status'] = 'ready'): FolderRecord {
  return { id: 'f1', name: 'Wohnung', parentId: null, status, createdAt: ts, updatedAt: ts };
}

async function setup(record: FolderRecord, inputs: Record<string, unknown> = {}) {
  await TestBed.configureTestingModule({ imports: [FolderTile] }).compileComponents();
  const fixture = TestBed.createComponent(FolderTile);
  fixture.componentRef.setInput('folder', record);
  for (const [key, value] of Object.entries(inputs)) fixture.componentRef.setInput(key, value);
  fixture.detectChanges();
  return fixture;
}

function openMenu(fixture: ComponentFixture<FolderTile>): void {
  (fixture.nativeElement.querySelector('.tile-more') as HTMLButtonElement).click();
  fixture.detectChanges();
}

function menuItems(fixture: ComponentFixture<FolderTile>): string[] {
  return [...(fixture.nativeElement as HTMLElement).querySelectorAll('.menu-item')].map((b) =>
    b.textContent!.trim(),
  );
}

function dragEvent(type: string, item?: DragItem): DragEvent {
  const data = new Map<string, string>();
  if (item) data.set(DRAG_MIME, JSON.stringify(item));
  const event = new Event(type, { bubbles: true, cancelable: true }) as DragEvent;
  Object.defineProperty(event, 'dataTransfer', {
    value: {
      get types() {
        return [...data.keys()];
      },
      getData: (mime: string) => data.get(mime) ?? '',
      setData: (mime: string, value: string) => data.set(mime, value),
      effectAllowed: 'all',
    },
  });
  return event;
}

describe('FolderTile (issue #33)', () => {
  it('ready: ⋮ offers Rename, Move to…, then a divider and destructive Delete', async () => {
    const fixture = await setup(folder());
    const el = fixture.nativeElement as HTMLElement;

    openMenu(fixture);

    expect(menuItems(fixture)).toEqual(['Rename', 'Move to…', 'Delete']);
    expect(el.querySelectorAll('.menu-sep')).toHaveLength(1);
    expect(el.querySelector('.menu-item.is-destructive')?.textContent).toContain('Delete');
  });

  it('emits the picked verb and closes the menu', async () => {
    const fixture = await setup(folder());
    const actions: FolderTileAction[] = [];
    fixture.componentInstance.action.subscribe((a) => actions.push(a));

    openMenu(fixture);
    ([...fixture.nativeElement.querySelectorAll('.menu-item')] as HTMLButtonElement[])
      .find((b) => b.textContent!.includes('Move to…'))!
      .click();
    fixture.detectChanges();

    expect(actions).toEqual(['move']);
    expect(fixture.nativeElement.querySelector('.menu')).toBeNull();
  });

  it('the shield dismisses the menu without opening the Folder (issue #64)', async () => {
    const fixture = await setup(folder());
    const el = fixture.nativeElement as HTMLElement;
    const opened = vi.fn();
    fixture.componentInstance.opened.subscribe(opened);

    openMenu(fixture);
    expect(el.querySelector('.menu')).toBeTruthy();

    (el.querySelector('.menu-shield') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(el.querySelector('.menu')).toBeNull();
    expect(opened).not.toHaveBeenCalled();

    el.click();
    expect(opened).toHaveBeenCalledOnce();
  });

  it('shows the name and a deep-count badge; clicking opens the Folder', async () => {
    const fixture = await setup(folder(), { documentCount: 7, folderCount: 3 });
    const el = fixture.nativeElement as HTMLElement;
    const opened = vi.fn();
    fixture.componentInstance.opened.subscribe(opened);

    expect(el.querySelector('.tile-name')?.textContent).toContain('Wohnung');
    expect(el.querySelector('[data-testid="folder-count"]')?.textContent?.trim()).toBe(
      '7 documents in 3 folders',
    );

    el.click();
    expect(opened).toHaveBeenCalled();
  });

  it('deleting: spinner, not openable, no menu until a delete has failed', async () => {
    const fixture = await setup(folder('deleting'));
    const el = fixture.nativeElement as HTMLElement;
    const opened = vi.fn();
    fixture.componentInstance.opened.subscribe(opened);

    expect(el.textContent).toContain('Deleting…');
    expect(el.querySelector('.tile-more')).toBeNull();
    el.click();
    expect(opened).not.toHaveBeenCalled();

    fixture.componentRef.setInput('deleteFailed', true);
    fixture.detectChanges();
    openMenu(fixture);
    expect(menuItems(fixture)).toEqual(['Retry delete']);
  });

  it('is draggable and carries a Folder drag item', async () => {
    const fixture = await setup(folder());
    const el = fixture.nativeElement as HTMLElement;
    const event = dragEvent('dragstart');

    expect(el.getAttribute('draggable')).toBe('true');
    el.dispatchEvent(event);

    expect(JSON.parse(event.dataTransfer!.getData(DRAG_MIME))).toEqual({
      kind: 'folder',
      id: 'f1',
    });
  });

  it('accepts a dropped item and emits it; ignores file drops', async () => {
    const fixture = await setup(folder());
    const el = fixture.nativeElement as HTMLElement;
    const dropped: DragItem[] = [];
    fixture.componentInstance.itemDropped.subscribe((item) => dropped.push(item));

    const over = dragEvent('dragover', { kind: 'document', id: 'd1' });
    el.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(true);

    el.dispatchEvent(dragEvent('drop', { kind: 'document', id: 'd1' }));
    expect(dropped).toEqual([{ kind: 'document', id: 'd1' }]);

    const fileOver = dragEvent('dragover');
    el.dispatchEvent(fileOver);
    expect(fileOver.defaultPrevented).toBe(false);
  });
});
