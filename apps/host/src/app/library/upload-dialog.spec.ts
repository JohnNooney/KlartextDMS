import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import type { FolderTree } from '../data/folder-tree';
import { UploadDialog } from './upload-dialog';

const TREE: FolderTree = {
  folders: [
    {
      folder: {
        id: 'f1',
        name: 'Verträge',
        parentId: null,
        status: 'ready',
        createdAt: { seconds: 1_700_000_000, nanoseconds: 0 },
        updatedAt: { seconds: 1_700_000_000, nanoseconds: 0 },
      },
      folders: [],
      documents: [],
      deepDocumentCount: 0,
      deepFolderCount: 0,
    },
  ],
  documents: [],
};

async function setup(initialFolderId: string | null = null) {
  await TestBed.configureTestingModule({ imports: [UploadDialog] }).compileComponents();
  const fixture = TestBed.createComponent(UploadDialog);
  fixture.componentRef.setInput('tree', TREE);
  fixture.componentRef.setInput('initialFolderId', initialFolderId);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  let picked: { files: File[]; folderId: string | null }[] = [];
  let closed = 0;
  fixture.componentInstance.picked.subscribe((p: { files: File[]; folderId: string | null }) =>
    picked.push(p),
  );
  fixture.componentInstance.closed.subscribe(() => closed++);
  return { fixture, el, emitted: () => ({ picked, closed }) };
}

function escape(fixture: ComponentFixture<UploadDialog>): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  fixture.detectChanges();
}

function chooseDestination(el: HTMLElement, name: string): void {
  [...el.querySelectorAll<HTMLButtonElement>('.picker-row')]
    .find((b) => b.textContent!.includes(name))!
    .click();
}

function button(el: HTMLElement, label: string): HTMLButtonElement {
  return [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
    b.textContent!.includes(label),
  )!;
}

describe('UploadDialog — discard guard (issue #151)', () => {
  it('a clean dialog closes on Escape with no alert', async () => {
    const { fixture, el, emitted } = await setup();
    escape(fixture);
    expect(emitted().closed).toBe(1);
    expect(el.querySelector('app-discard-changes-alert')).toBeNull();
  });

  it('changing the destination dirties — Escape raises the alert', async () => {
    const { fixture, el, emitted } = await setup();
    chooseDestination(el, 'Verträge');
    fixture.detectChanges();
    expect(fixture.componentInstance.dirty()).toBe(true);

    escape(fixture);
    expect(emitted().closed).toBe(0);
    expect(el.querySelector('app-discard-changes-alert')).toBeTruthy();
  });

  it('Keep Editing keeps the picked destination; Discard closes', async () => {
    const { fixture, el, emitted } = await setup();
    chooseDestination(el, 'Verträge');
    fixture.detectChanges();
    escape(fixture);

    button(el, 'Keep Editing').click();
    fixture.detectChanges();
    expect(emitted().closed).toBe(0);
    expect(el.querySelector('.picker-row.is-selected')!.textContent).toContain('Verträge');

    escape(fixture);
    button(el, 'Discard').click();
    fixture.detectChanges();
    expect(emitted().closed).toBe(1);
  });

  it('picking files is the submit — it emits picked, never the alert', async () => {
    const { fixture, el, emitted } = await setup();
    chooseDestination(el, 'Verträge');
    fixture.detectChanges();

    const file = new File([new Uint8Array(4)], 'a.pdf', { type: 'application/pdf' });
    const event = new Event('drop', { bubbles: true, cancelable: true });
    Object.assign(event, { dataTransfer: { files: [file] } });
    el.querySelector('.drop-zone')!.dispatchEvent(event);
    fixture.detectChanges();

    expect(emitted().picked).toEqual([{ files: [file], folderId: 'f1' }]);
    expect(el.querySelector('app-discard-changes-alert')).toBeNull();
  });
});
