import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import type { BatchCandidates, BatchCriterion } from '../bus/batch-reanalysis';
import type { DocumentRecord } from '../data/document';
import type { FolderRecord } from '../data/folder';
import { BatchReanalysisDialog } from './batch-reanalysis-dialog';

let seq = 0;
function doc(overrides: Partial<DocumentRecord> = {}): DocumentRecord {
  const id = `doc-${++seq}`;
  return {
    id,
    ownerId: 'owner',
    title: `Document ${seq}`,
    originalFilename: `${id}.pdf`,
    contentType: 'application/pdf',
    sizeBytes: 1234,
    storagePath: `users/owner/documents/${id}.pdf`,
    status: 'ready',
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

const WOHNUNG = folder('f-wohnung', 'Wohnung', null);
const NEBENKOSTEN = folder('f-neben', 'Nebenkosten', WOHNUNG.id);
const JAHR = folder('f-2025', '2025', NEBENKOSTEN.id);

function candidates(partial: Partial<BatchCandidates>): BatchCandidates {
  const outdated = partial.outdated ?? [];
  const failed = partial.failed ?? [];
  return { outdated, failed, all: partial.all ?? [...outdated, ...failed] };
}

const DONE = { a: { doneAt: '2026-10-01T00:00:00.000Z' }, b: { doneAt: '2026-10-02T00:00:00.000Z' } };

async function setup(input: BatchCandidates, scope: FolderRecord | null = WOHNUNG) {
  await TestBed.configureTestingModule({ imports: [BatchReanalysisDialog] }).compileComponents();
  const fixture = TestBed.createComponent(BatchReanalysisDialog);
  fixture.componentRef.setInput('candidates', input);
  fixture.componentRef.setInput('scope', scope);
  fixture.componentRef.setInput('folders', [WOHNUNG, NEBENKOSTEN, JAHR]);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const started: BatchCriterion[] = [];
  let closed = 0;
  fixture.componentInstance.started.subscribe((c) => started.push(c));
  fixture.componentInstance.closed.subscribe(() => closed++);
  const radio = (key: BatchCriterion) =>
    el.querySelector<HTMLInputElement>(`[data-criterion="${key}"] input`)!;
  const primary = () => el.querySelector<HTMLButtonElement>('.dialog-foot .btn-primary')!;
  return { fixture, el, radio, primary, started, closed: () => closed };
}

// Issue #159: the dialog over the Batch re-analysis criteria (#158).
describe('BatchReanalysisDialog', () => {
  it('names the scope, or the whole library at root', async () => {
    const inFolder = await setup(candidates({ outdated: [doc()] }));
    expect(inFolder.el.querySelector('[data-testid="batch-scope"]')!.textContent).toMatch(
      /In\s+Wohnung\s+and the folders inside it\.\s+Klartext reads each one again with the current analysis\./,
    );
    TestBed.resetTestingModule();
    const atRoot = await setup(candidates({ outdated: [doc()] }), null);
    expect(atRoot.el.querySelector('[data-testid="batch-scope"]')!.textContent).toContain(
      'Across all your documents.',
    );
  });

  it('shows each criterion with its hint and live count', async () => {
    const h = await setup(candidates({ outdated: [doc(), doc()], failed: [doc()] }));
    const rows = [...h.el.querySelectorAll('.radio')].map((row) => [
      row.querySelector('.radio-label')!.textContent!.trim(),
      row.querySelector('.radio-hint')!.textContent!.trim(),
      row.querySelector('.radio-count')!.textContent!.trim(),
    ]);
    expect(rows).toEqual([
      ['Outdated format', 'Analyzed in an earlier format — no dates on Action Items.', '2'],
      ["Couldn't analyze", 'The last analysis failed.', '1'],
      ['All documents', 'Every analyzed document, including up-to-date ones.', '3'],
    ]);
  });

  it('defaults to Outdated, then Couldn\'t analyze, then All, and disables empty rows', async () => {
    const outdated = await setup(candidates({ outdated: [doc()], failed: [doc()] }));
    expect(outdated.radio('outdated').checked).toBe(true);
    TestBed.resetTestingModule();

    const failed = await setup(candidates({ failed: [doc()] }));
    expect(failed.radio('outdated').disabled).toBe(true);
    expect(failed.radio('failed').checked).toBe(true);
    TestBed.resetTestingModule();

    const all = await setup(candidates({ all: [doc()] }));
    expect(all.radio('outdated').disabled).toBe(true);
    expect(all.radio('failed').disabled).toBe(true);
    expect(all.radio('all').checked).toBe(true);
    expect(all.primary().textContent!.trim()).toBe('Re-analyze 1 document');
  });

  it('starts the picked criterion; the primary names its count', async () => {
    const h = await setup(candidates({ outdated: [doc()], failed: [doc(), doc()] }));
    expect(h.primary().textContent!.trim()).toBe('Re-analyze 1 document');

    h.radio('all').click();
    h.fixture.detectChanges();
    expect(h.primary().textContent!.trim()).toBe('Re-analyze 3 documents');
    h.primary().click();

    expect(h.started).toEqual(['all']);
  });

  it('Cancel closes without starting', async () => {
    const h = await setup(candidates({ outdated: [doc()] }));
    [...h.el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent!.trim() === 'Cancel')!.click();
    expect(h.closed()).toBe(1);
    expect(h.started).toEqual([]);
  });

  it('lists the members collapsed, with relative Folder paths and Done chips', async () => {
    const h = await setup(
      candidates({
        outdated: [
          doc({ title: 'Mietvertrag', folderId: WOHNUNG.id }),
          doc({ title: 'Heizkosten', folderId: JAHR.id, actionItemStates: DONE }),
        ],
      }),
    );
    const toggle = h.el.querySelector<HTMLButtonElement>('.list-toggle')!;
    expect(toggle.textContent!.trim()).toBe('Show 2 documents');
    expect(h.el.querySelector('.list-rows')).toBeNull();

    toggle.click();
    h.fixture.detectChanges();
    const rows = [...h.el.querySelectorAll('.list-rows li')].map((li) =>
      [...li.querySelectorAll('span')].map((s) => s.textContent!.trim()),
    );
    expect(rows).toEqual([['Mietvertrag'], ['Heizkosten', 'Nebenkosten › 2025', '2 done']]);
  });

  it('warns only when the selected members carry Done marks', async () => {
    const h = await setup(
      candidates({
        outdated: [doc()],
        failed: [doc({ actionItemStates: DONE }), doc({ actionItemStates: DONE })],
      }),
    );
    expect(h.el.querySelector('[data-testid="batch-done-warning"]')).toBeNull();

    h.radio('failed').click();
    h.fixture.detectChanges();
    expect(h.el.querySelector('[data-testid="batch-done-warning"]')!.textContent!.trim()).toBe(
      '2 of these documents have items marked Done. Re-analyzing can bring them back as not done, and a reminder you add again may duplicate one already in your calendar.',
    );
  });

  it('warns about quota only above 50 documents', async () => {
    const fifty = Array.from({ length: 50 }, () => doc());
    const h = await setup(candidates({ outdated: fifty, all: [...fifty, doc()] }));
    expect(h.el.querySelector('[data-testid="batch-quota"]')).toBeNull();

    h.radio('all').click();
    h.fixture.detectChanges();
    expect(h.el.querySelector('[data-testid="batch-quota"]')!.textContent!.trim()).toBe(
      'This is a large batch — 51 documents can take several minutes and use a lot of your AI analysis. You can keep working meanwhile.',
    );
  });
});
