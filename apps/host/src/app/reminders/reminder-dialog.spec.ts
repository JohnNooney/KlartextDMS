import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import type { ActionTiming } from '@klartext/bus-contract';
import type { DocumentRecord } from '../data/document';
import { ReminderDialog } from './reminder-dialog';
import type { ReminderDraft } from './reminders';

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

function draft(timing: ActionTiming): ReminderDraft {
  return {
    doc: DOC,
    item: { id: 'ai_1', text: 'Give three months\u2019 notice', sourceQuote: '…', timing },
    origin: 'http://localhost:4200',
  };
}

async function setup(timing: ActionTiming) {
  await TestBed.configureTestingModule({ imports: [ReminderDialog] }).compileComponents();
  const fixture = TestBed.createComponent(ReminderDialog);
  fixture.componentRef.setInput('draft', draft(timing));
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  let closed = 0;
  fixture.componentInstance.closed.subscribe(() => closed++);
  return { fixture, el, emitted: () => ({ closed }) };
}

function escape(fixture: ComponentFixture<ReminderDialog>): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  fixture.detectChanges();
}

function type(el: HTMLElement, testId: string, value: string): HTMLInputElement {
  const input = el.querySelector<HTMLInputElement>(`[data-testid="${testId}"]`)!;
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

describe('ReminderDialog — discard guard (issue #151)', () => {
  it('a clean dialog closes on Escape with no alert', async () => {
    const { fixture, el, emitted } = await setup({ kind: 'NONE' });
    escape(fixture);
    expect(emitted().closed).toBe(1);
    expect(el.querySelector('app-discard-changes-alert')).toBeNull();
  });

  it('a prefilled FIXED_DATE is clean — it matches the value it opened with', async () => {
    const { fixture, el, emitted } = await setup({ kind: 'FIXED_DATE', dueDate: '2026-11-15' });
    expect(fixture.componentInstance.dirty()).toBe(false);
    escape(fixture);
    expect(emitted().closed).toBe(1);
    expect(el.querySelector('app-discard-changes-alert')).toBeNull();
  });

  it('a picked date dirties — Escape raises the alert, input intact', async () => {
    const { fixture, el, emitted } = await setup({ kind: 'NONE' });
    type(el, 'reminder-date', '2026-12-01');
    fixture.detectChanges();
    expect(fixture.componentInstance.dirty()).toBe(true);

    escape(fixture);
    expect(emitted().closed).toBe(0);
    expect(el.querySelector('app-discard-changes-alert')).toBeTruthy();
    expect(el.querySelector<HTMLInputElement>('[data-testid="reminder-date"]')!.value).toBe(
      '2026-12-01',
    );
  });

  it('a changed alarm offset dirties', async () => {
    const { fixture, el, emitted } = await setup({ kind: 'FIXED_DATE', dueDate: '2026-11-15' });
    const alarm = el.querySelector<HTMLSelectElement>('[data-testid="reminder-alarm"]')!;
    alarm.value = '1';
    alarm.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(fixture.componentInstance.dirty()).toBe(true);

    escape(fixture);
    expect(emitted().closed).toBe(0);
    expect(el.querySelector('app-discard-changes-alert')).toBeTruthy();
  });

  it('a typed notice anchor dirties', async () => {
    const { fixture, el } = await setup({
      kind: 'NOTICE_PERIOD',
      duration: 3,
      unit: 'MONTHS',
      anchor: 'moving out',
    });
    type(el, 'reminder-anchor', '2026-10-31');
    fixture.detectChanges();
    expect(fixture.componentInstance.dirty()).toBe(true);
  });

  it('a deadline typed then cleared returns to its opening value — clean', async () => {
    const { fixture, el } = await setup({
      kind: 'NOTICE_PERIOD',
      duration: 3,
      unit: 'MONTHS',
      anchor: 'moving out',
    });
    type(el, 'reminder-deadline', '2026-07-31');
    fixture.detectChanges();
    expect(fixture.componentInstance.dirty()).toBe(true);

    type(el, 'reminder-deadline', '');
    fixture.detectChanges();
    expect(fixture.componentInstance.dirty()).toBe(false);
  });

  it('Keep Editing returns to the dialog with input and focus intact', async () => {
    const { fixture, el, emitted } = await setup({ kind: 'NONE' });
    const input = type(el, 'reminder-date', '2026-12-01');
    fixture.detectChanges();
    escape(fixture);

    button(el, 'Keep Editing').click();
    fixture.detectChanges();

    expect(el.querySelector('app-discard-changes-alert')).toBeNull();
    expect(emitted().closed).toBe(0);
    expect(input.value).toBe('2026-12-01');
    expect(document.activeElement).toBe(input);
  });

  it('Discard closes the dialog — closed emits', async () => {
    const { fixture, el, emitted } = await setup({ kind: 'NONE' });
    type(el, 'reminder-date', '2026-12-01');
    fixture.detectChanges();
    escape(fixture);

    button(el, 'Discard').click();
    fixture.detectChanges();
    expect(emitted().closed).toBe(1);
  });

  it('the footer Cancel closes a dirty dialog without asking', async () => {
    const { fixture, el, emitted } = await setup({ kind: 'NONE' });
    type(el, 'reminder-date', '2026-12-01');
    fixture.detectChanges();

    button(el, 'Cancel').click();
    fixture.detectChanges();
    expect(emitted().closed).toBe(1);
    expect(el.querySelector('app-discard-changes-alert')).toBeNull();
  });
});
