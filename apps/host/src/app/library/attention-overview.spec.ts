import type { ActionTiming, ExtractionRecord } from '@klartext/bus-contract';
import { describe, expect, it } from 'vitest';
import type { DocumentRecord, DocumentStatus } from '../data/document';
import type { FolderRecord } from '../data/folder';
import { buildAttentionOverview, readyDocumentsInScope } from './attention-overview';

const TODAY = new Date(2026, 9, 22); // 22 Oct 2026, local

const stamp = { seconds: 1_700_000_000, nanoseconds: 0 };

function doc(
  id: string,
  folderId: string | null,
  overrides: Partial<DocumentRecord> = {},
): DocumentRecord {
  return {
    id,
    ownerId: 'owner',
    title: `Title ${id}`,
    originalFilename: `${id}.pdf`,
    contentType: 'application/pdf',
    sizeBytes: 1,
    storagePath: `p/${id}`,
    status: 'ready' as DocumentStatus,
    folderId,
    createdAt: stamp,
    updatedAt: stamp,
    ...overrides,
  };
}

function folder(id: string, name: string, parentId: string | null): FolderRecord {
  return { id, name, parentId, status: 'ready', createdAt: stamp, updatedAt: stamp };
}

function extraction(
  documentId: string,
  items: { text: string; timing: ActionTiming; page?: number }[],
): ExtractionRecord {
  return {
    documentId,
    schemaVersion: 2,
    promptVersion: 'klartext-extraction-v2',
    model: 'm',
    documentType: 'OTHER',
    sourceLanguage: 'de',
    plainEnglishSummary: 's',
    extractionStatus: 'COMPLETE',
    actionItems: items.map((item, i) => ({
      id: `${documentId}-${i}`,
      text: item.text,
      sourceQuote: `quote ${item.text}`,
      page: item.page,
      timing: item.timing,
    })),
    keyTakeaways: [],
    createdAt: stamp,
  };
}

const fixed = (dueDate: string): ActionTiming => ({ kind: 'FIXED_DATE', dueDate });

describe('buildAttentionOverview', () => {
  const folders = [
    folder('a', 'Wohnung', null),
    folder('b', 'Mietverträge', 'a'),
    folder('c', 'Other', null),
  ];

  const build = (
    documents: DocumentRecord[],
    extractions: ExtractionRecord[],
    scopeFolderId: string | null = null,
  ) =>
    buildAttentionOverview({
      scoped: readyDocumentsInScope(documents, folders, scopeFolderId),
      extractions: new Map(extractions.map((e) => [e.documentId, e])),
      today: TODAY,
    });

  it('groups Action Items Overdue / This week / Later / No date, in that order, omitting empty groups', () => {
    const groups = build(
      [doc('d1', null)],
      [
        extraction('d1', [
          { text: 'none', timing: { kind: 'NONE' } },
          { text: 'later', timing: fixed('2026-12-01') },
          { text: 'overdue', timing: fixed('2026-10-19') },
          { text: 'soon', timing: fixed('2026-10-26') },
        ]),
      ],
    );

    expect(groups.map((g) => [g.key, g.label, g.items.map((i) => i.text)])).toEqual([
      ['overdue', 'Overdue', ['overdue']],
      ['thisWeek', 'This week', ['soon']],
      ['later', 'Later', ['later']],
      ['noDate', 'No date', ['none']],
    ]);
    expect(build([doc('d1', null)], [extraction('d1', [{ text: 'x', timing: { kind: 'NONE' } }])]).map((g) => g.key)).toEqual(['noDate']);
  });

  it('treats today and the next seven days as This week and yesterday as Overdue', () => {
    const groups = build(
      [doc('d1', null)],
      [
        extraction('d1', [
          { text: 'yesterday', timing: fixed('2026-10-21') },
          { text: 'today', timing: fixed('2026-10-22') },
          { text: 'in7', timing: fixed('2026-10-29') },
          { text: 'in8', timing: fixed('2026-10-30') },
        ]),
      ],
    );
    const keyOf = (text: string) =>
      groups.find((g) => g.items.some((i) => i.text === text))?.key;
    expect([keyOf('yesterday'), keyOf('today'), keyOf('in7'), keyOf('in8')]).toEqual([
      'overdue',
      'thisWeek',
      'thisWeek',
      'later',
    ]);
  });

  it('files loose recurring and notice-period items under Later and labels their timing', () => {
    const groups = build(
      [doc('d1', null)],
      [
        extraction('d1', [
          { text: 'rent', timing: { kind: 'RECURRING', cadence: 'MONTHLY', scheduleLabel: 'Monthly by the 3rd working day' } },
          { text: 'notice', timing: { kind: 'NOTICE_PERIOD', duration: 3, unit: 'MONTHS', anchor: 'moving out' } },
          { text: 'one', timing: { kind: 'NOTICE_PERIOD', duration: 1, unit: 'WEEKS', anchor: 'x' } },
        ]),
      ],
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe('later');
    expect(groups[0].items.map((i) => i.timingLabel)).toEqual([
      'Monthly by the 3rd working day',
      '3 months’ notice · moving out',
      '1 week’s notice · x',
    ]);
  });

  it('files a monthly item whose next occurrence is near under This week, ordered by that date', () => {
    const groups = build(
      [doc('d1', null)],
      [
        extraction('d1', [
          { text: 'fee', timing: fixed('2026-10-27') },
          { text: 'rent', timing: { kind: 'RECURRING', cadence: 'MONTHLY', dayOfMonth: 25, scheduleLabel: 'Monthly by the 25th' } },
        ]),
      ],
    );
    expect(groups.map((g) => [g.key, g.items.map((i) => [i.text, i.timingLabel])])).toEqual([
      ['thisWeek', [['rent', 'Due in 3 days · Monthly by the 25th'], ['fee', 'Due in 5 days']]],
    ]);
  });

  it('labels dated items relative to today inside the week window, absolutely beyond it', () => {
    const groups = build(
      [doc('d1', null)],
      [
        extraction('d1', [
          { text: 'a', timing: fixed('2026-10-19') },
          { text: 'b', timing: fixed('2026-10-22') },
          { text: 'c', timing: fixed('2026-10-26') },
          { text: 'd', timing: fixed('2026-12-01') },
          { text: 'e', timing: fixed('2026-10-21') },
          { text: 'f', timing: fixed('2024-07-31') },
          { text: 'g', timing: { kind: 'NONE' } },
        ]),
      ],
    );
    const when = Object.fromEntries(groups.flatMap((g) => g.items.map((i) => [i.text, i.timingLabel])));
    expect(when).toEqual({
      a: 'Due 3 days ago',
      b: 'Due today',
      c: 'Due in 4 days',
      d: 'Due 1 Dec 2026',
      e: 'Due yesterday',
      f: 'Due 31 Jul 2024',
      g: null,
    });
  });

  it('orders dated items by due date, then by Document title', () => {
    const groups = build(
      [doc('d1', null, { title: 'Zebra' }), doc('d2', null, { title: 'Apple' })],
      [
        extraction('d1', [{ text: 'z-early', timing: fixed('2026-10-01') }]),
        extraction('d2', [
          { text: 'a-late', timing: fixed('2026-10-10') },
          { text: 'a-early', timing: fixed('2026-10-01') },
        ]),
      ],
    );
    expect(groups[0].items.map((i) => i.text)).toEqual(['a-early', 'z-early', 'a-late']);
  });

  it('carries the cited page, quote and Document so a click can open it', () => {
    const [group] = build(
      [doc('d1', null, { title: 'Mietvertrag' })],
      [extraction('d1', [{ text: 'pay', page: 3, timing: { kind: 'NONE' } }])],
    );
    expect(group.items[0]).toMatchObject({
      id: 'd1-0',
      documentId: 'd1',
      documentTitle: 'Mietvertrag',
      page: 3,
      sourceQuote: 'quote pay',
    });
  });

  it('rolls up deeply from the browsed Folder, with path chips relative to it', () => {
    const documents = [doc('root', null), doc('inA', 'a'), doc('inB', 'b'), doc('inC', 'c')];
    const extractions = documents.map((d) =>
      extraction(d.id, [{ text: d.id, timing: { kind: 'NONE' } }]),
    );

    const atRoot = build(documents, extractions, null)[0].items;
    expect(atRoot.map((i) => [i.documentId, i.path])).toEqual([
      ['root', null],
      ['inA', 'Wohnung'],
      ['inB', 'Wohnung / Mietverträge'],
      ['inC', 'Other'],
    ]);

    const atA = build(documents, extractions, 'a')[0].items;
    expect(atA.map((i) => [i.documentId, i.path])).toEqual([
      ['inA', null],
      ['inB', 'Mietverträge'],
    ]);
  });

  it('skips Documents that are not ready or have no stored Extraction', () => {
    const groups = build(
      [doc('up', null, { status: 'uploading' }), doc('none', null), doc('ok', null)],
      [
        extraction('up', [{ text: 'x', timing: { kind: 'NONE' } }]),
        extraction('ok', [{ text: 'y', timing: { kind: 'NONE' } }]),
      ],
    );
    expect(groups.flatMap((g) => g.items.map((i) => i.documentId))).toEqual(['ok']);
  });

  it('returns no groups when nothing needs attention', () => {
    expect(build([doc('d1', null)], [extraction('d1', [])])).toEqual([]);
  });
});
