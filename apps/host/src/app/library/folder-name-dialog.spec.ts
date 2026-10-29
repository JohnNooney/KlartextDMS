import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { FolderNameDialog } from './folder-name-dialog';

async function setup(inputs: Record<string, unknown> = {}) {
  await TestBed.configureTestingModule({ imports: [FolderNameDialog] }).compileComponents();
  const fixture = TestBed.createComponent(FolderNameDialog);
  for (const [key, value] of Object.entries(inputs)) fixture.componentRef.setInput(key, value);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  let closed = 0;
  fixture.componentInstance.closed.subscribe(() => closed++);
  return { fixture, el, emitted: () => ({ closed }) };
}

function escape(fixture: ComponentFixture<FolderNameDialog>): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  fixture.detectChanges();
}

function type(el: HTMLElement, testId: string, value: string): void {
  const input = el.querySelector<HTMLInputElement>(`[data-testid="${testId}"]`)!;
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

function button(el: HTMLElement, label: string): HTMLButtonElement {
  return [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
    b.textContent!.includes(label),
  )!;
}

describe('FolderNameDialog — discard guard (issue #151)', () => {
  it('a clean dialog closes on Escape with no alert', async () => {
    const { fixture, el, emitted } = await setup({ heading: 'New folder', withDetails: true });
    escape(fixture);
    expect(emitted().closed).toBe(1);
    expect(el.querySelector('app-discard-changes-alert')).toBeNull();
  });

  it('typing a name dirties — Escape raises the alert with input intact', async () => {
    const { fixture, el, emitted } = await setup({ heading: 'New folder', withDetails: true });
    type(el, 'folder-name-input', 'Taxes');
    fixture.detectChanges();
    expect(fixture.componentInstance.dirty()).toBe(true);

    escape(fixture);
    expect(emitted().closed).toBe(0);
    expect(el.querySelector('app-discard-changes-alert')).toBeTruthy();
    expect(el.querySelector<HTMLInputElement>('[data-testid="folder-name-input"]')!.value).toBe(
      'Taxes',
    );
  });

  it('detail fields dirty too — a description alone asks', async () => {
    const { fixture, el, emitted } = await setup({ heading: 'New folder', withDetails: true });
    type(el, 'folder-description', 'For the accountant');
    fixture.detectChanges();
    expect(fixture.componentInstance.dirty()).toBe(true);

    escape(fixture);
    expect(emitted().closed).toBe(0);
    expect(el.querySelector('app-discard-changes-alert')).toBeTruthy();
  });

  it('rename is clean while the name matches the folder it opened with', async () => {
    const { fixture, el, emitted } = await setup({
      heading: 'Rename folder',
      initialName: 'Verträge',
    });
    expect(fixture.componentInstance.dirty()).toBe(false);
    escape(fixture);
    expect(emitted().closed).toBe(1);
    expect(el.querySelector('app-discard-changes-alert')).toBeNull();
  });

  it('Keep Editing keeps the typed name; Discard closes', async () => {
    const { fixture, el, emitted } = await setup({ heading: 'New folder', withDetails: true });
    type(el, 'folder-name-input', 'Taxes');
    fixture.detectChanges();
    escape(fixture);

    button(el, 'Keep Editing').click();
    fixture.detectChanges();
    expect(emitted().closed).toBe(0);
    expect(el.querySelector<HTMLInputElement>('[data-testid="folder-name-input"]')!.value).toBe(
      'Taxes',
    );

    escape(fixture);
    button(el, 'Discard').click();
    fixture.detectChanges();
    expect(emitted().closed).toBe(1);
  });

  it('the footer Cancel closes a dirty dialog without asking', async () => {
    const { fixture, el, emitted } = await setup({ heading: 'New folder', withDetails: true });
    type(el, 'folder-name-input', 'Taxes');
    fixture.detectChanges();

    button(el, 'Cancel').click();
    fixture.detectChanges();
    expect(emitted().closed).toBe(1);
    expect(el.querySelector('app-discard-changes-alert')).toBeNull();
  });
});
