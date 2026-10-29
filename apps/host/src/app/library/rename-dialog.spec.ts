import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import type { DocumentRecord } from '../data/document';
import { RenameDialog } from './rename-dialog';

const DOC: DocumentRecord = {
  id: 'doc-1',
  ownerId: 'owner',
  title: 'Mietvertrag 2024',
  originalFilename: 'mietvertrag-2024.pdf',
  contentType: 'application/pdf',
  sizeBytes: 1234,
  storagePath: 'users/owner/documents/doc-1.pdf',
  status: 'ready',
  folderId: null,
  createdAt: { seconds: 1_700_000_000, nanoseconds: 0 },
  updatedAt: { seconds: 1_700_000_000, nanoseconds: 0 },
};

async function setup() {
  await TestBed.configureTestingModule({ imports: [RenameDialog] }).compileComponents();
  const fixture = TestBed.createComponent(RenameDialog);
  fixture.componentRef.setInput('doc', DOC);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  let saved: string[] = [];
  let closed = 0;
  fixture.componentInstance.saved.subscribe((title: string) => saved.push(title));
  fixture.componentInstance.closed.subscribe(() => closed++);
  return { fixture, el, emitted: () => ({ saved, closed }) };
}

function escape(fixture: ComponentFixture<RenameDialog>): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  fixture.detectChanges();
}

function type(el: HTMLElement, value: string): HTMLInputElement {
  const input = el.querySelector<HTMLInputElement>('[data-testid="rename-input"]')!;
  input.focus();
  input.value = value;
  input.dispatchEvent(new Event('input'));
  return input;
}

function button(el: HTMLElement, label: string): HTMLButtonElement {
  return [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
    b.textContent!.includes(label),
  )!;
}

describe('RenameDialog — discard guard (issue #151)', () => {
  it('reports clean until the field differs from the opening value', async () => {
    const { fixture, el } = await setup();
    expect(fixture.componentInstance.dirty()).toBe(false);

    type(el, 'New name');
    fixture.detectChanges();
    expect(fixture.componentInstance.dirty()).toBe(true);

    // Typing back to the opening value is clean again.
    type(el, 'Mietvertrag 2024');
    fixture.detectChanges();
    expect(fixture.componentInstance.dirty()).toBe(false);
  });

  it('a clean dialog closes on Escape with no alert', async () => {
    const { fixture, el, emitted } = await setup();
    escape(fixture);
    expect(emitted().closed).toBe(1);
    expect(el.querySelector('app-discard-changes-alert')).toBeNull();
  });

  it('a clean dialog closes on a backdrop click with no alert', async () => {
    const { fixture, el, emitted } = await setup();
    el.querySelector<HTMLButtonElement>('.backdrop')!.click();
    fixture.detectChanges();
    expect(emitted().closed).toBe(1);
    expect(el.querySelector('app-discard-changes-alert')).toBeNull();
  });

  it('Escape on a dirty dialog raises the alert — the dialog stays, input intact', async () => {
    const { fixture, el, emitted } = await setup();
    type(el, 'New name');
    fixture.detectChanges();

    escape(fixture);
    expect(emitted().closed).toBe(0);
    expect(el.querySelector('app-discard-changes-alert')).toBeTruthy();
    expect(el.querySelector<HTMLInputElement>('[data-testid="rename-input"]')!.value).toBe(
      'New name',
    );
  });

  it('a backdrop click on a dirty dialog raises the alert', async () => {
    const { fixture, el, emitted } = await setup();
    type(el, 'New name');
    fixture.detectChanges();

    el.querySelector<HTMLButtonElement>('.backdrop')!.click();
    fixture.detectChanges();
    expect(emitted().closed).toBe(0);
    expect(el.querySelector('app-discard-changes-alert')).toBeTruthy();
  });

  it('Keep Editing returns to the dialog with input and focus intact', async () => {
    const { fixture, el, emitted } = await setup();
    const input = type(el, 'New name');
    fixture.detectChanges();
    escape(fixture);

    button(el, 'Keep Editing').click();
    fixture.detectChanges();

    expect(el.querySelector('app-discard-changes-alert')).toBeNull();
    expect(emitted().closed).toBe(0);
    expect(input.value).toBe('New name');
    expect(document.activeElement).toBe(input);

    // The dialog still guards the next implicit close.
    escape(fixture);
    expect(el.querySelector('app-discard-changes-alert')).toBeTruthy();
    expect(emitted().closed).toBe(0);
  });

  it('Discard closes the dialog — closed emits', async () => {
    const { fixture, el, emitted } = await setup();
    type(el, 'New name');
    fixture.detectChanges();
    escape(fixture);

    button(el, 'Discard').click();
    fixture.detectChanges();
    expect(emitted().closed).toBe(1);
  });

  it('the footer Cancel closes a dirty dialog without asking', async () => {
    const { fixture, el, emitted } = await setup();
    type(el, 'New name');
    fixture.detectChanges();

    button(el, 'Cancel').click();
    fixture.detectChanges();
    expect(emitted().closed).toBe(1);
    expect(el.querySelector('app-discard-changes-alert')).toBeNull();
  });

  it('submitting saves without asking', async () => {
    const { fixture, el, emitted } = await setup();
    type(el, 'New name');
    fixture.detectChanges();

    button(el, 'Save').click();
    fixture.detectChanges();
    expect(emitted().saved).toEqual(['New name']);
    expect(emitted().closed).toBe(0);
    expect(el.querySelector('app-discard-changes-alert')).toBeNull();
  });
});
