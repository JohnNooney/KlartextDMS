import type { ActionTiming, ExtractionRecord, KeyTakeaway } from '@klartext/bus-contract';
import { describe, expect, it } from 'vitest';
import type { DocumentRecord, DocumentStatus } from '../data/document';
import type { FolderRecord } from '../data/folder';
import { buildSearchResults } from './library-search';

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

function folder(
  id: string,
  name: string,
  parentId: string | null,
  details: Pick<FolderRecord, 'description' | 'keywords'> = {},
): FolderRecord {
  return { id, name, parentId, status: 'ready', createdAt: stamp, updatedAt: stamp, ...details };
}

function extraction(
  documentId: string,
  overrides: Partial<ExtractionRecord> = {},
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
    actionItems: [],
    keyTakeaways: [],
    createdAt: stamp,
    ...overrides,
  };
}

const item = (
  text: string,
  sourceQuote: string,
  page?: number,
  timing: ActionTiming = { kind: 'NONE' },
) => ({ id: `ai-${text}`, text, sourceQuote, page, timing });

const takeaway = (text: string, sourceQuote: string, page?: number): KeyTakeaway => ({
  text,
  sourceQuote,
  page,
});

const build = (input: {
  query: string;
  documents?: DocumentRecord[];
  folders?: FolderRecord[];
  extractions?: ExtractionRecord[];
  scopeFolderId?: string | null;
  browsedFolderId?: string | null;
}) =>
  buildSearchResults({
    documents: input.documents ?? [],
    folders: input.folders ?? [],
    extractions: new Map((input.extractions ?? []).map((e) => [e.documentId, e])),
    scopeFolderId: input.scopeFolderId ?? null,
    browsedFolderId: input.browsedFolderId ?? null,
    query: input.query,
  });

const snippetText = (result: { snippet: { text: string }[] | null }) =>
  result.snippet?.map((s) => s.text).join('') ?? null;

describe('buildSearchResults (issue #121, decision #103)', () => {
  it('matches a Document title and file name by substring, case-insensitively', () => {
    const { documents } = build({
      query: 'mietvertrag-2024',
      documents: [
        doc('d1', null, { title: 'Mietvertrag', originalFilename: 'mietvertrag-2024.pdf' }),
        doc('d2', null, { title: 'Scan' }),
      ],
    });
    expect(documents.map((r) => r.doc.id)).toEqual(['d1']);
    expect(documents[0].reasons).toEqual(['Filename']);
    expect(snippetText(documents[0])).toBe('mietvertrag-2024.pdf');
  });

  it('folds diacritics on both sides: "Behorden" finds Behörden, "kuendigung" finds Kündigungsfrist', () => {
    const results = build({
      query: 'behorden',
      folders: [folder('f1', 'Behörden', null)],
    });
    expect(results.folders.map((r) => r.folder.id)).toEqual(['f1']);
    expect(results.folders[0].reasons).toEqual(['Name']);

    const quotes = build({
      query: 'kuendigungsfrist',
      documents: [doc('d1', null)],
      extractions: [
        extraction('d1', {
          actionItems: [item('Give notice', 'Die Kündigungsfrist beträgt drei Monate.', 3)],
        }),
      ],
    });
    expect(quotes.documents[0].reasons).toEqual(['Quote']);
    expect(snippetText(quotes.documents[0])).toBe('Die Kündigungsfrist beträgt drei Monate.');
    expect(quotes.documents[0].focus).toEqual({ page: 3, quote: 'Die Kündigungsfrist beträgt drei Monate.' });
  });

  it('folds ß to ss so "strasse" finds "Straße"', () => {
    const { documents } = build({
      query: 'strasse',
      documents: [doc('d1', null, { title: 'Straße 12' })],
    });
    expect(documents).toHaveLength(1);
  });

  it('ANDs terms: every term must hit somewhere in the item', () => {
    const { documents } = build({
      query: 'deposit instalments',
      documents: [doc('d1', null), doc('d2', null)],
      extractions: [
        extraction('d1', {
          actionItems: [item('A deposit, payable in three instalments', 'Kaution … Raten', 2)],
        }),
        extraction('d2', {
          actionItems: [item('A deposit is due', 'Kaution', 2)],
        }),
      ],
    });
    expect(documents.map((r) => r.doc.id)).toEqual(['d1']);
  });

  it('lets terms hit different fields — title plus takeaway still satisfies the AND', () => {
    const { documents } = build({
      query: 'mietvertrag repairs',
      documents: [doc('d1', null, { title: 'Mietvertrag' })],
      extractions: [
        extraction('d1', {
          keyTakeaways: [takeaway('You pay for small repairs up to €100', 'Kleinreparaturen', 4)],
        }),
      ],
    });
    expect(documents).toHaveLength(1);
    expect(documents[0].reasons).toEqual(['Title', 'Key takeaway']);
  });

  it('ranks results by the fixed 5-tier field order — Action Item quotes sit with their item', () => {
    // Titles/names > keywords/type > Action Item text+quote > takeaways/summary
    // > Folder descriptions, Key Takeaway quotes (decision #103's table).
    const { documents } = build({
      query: 'hit',
      documents: [
        doc('quote', null, { title: 'No title match' }),
        doc('title', null, { title: 'A hit title' }),
        doc('item', null, { title: 'No match' }),
        doc('actquote', null, { title: 'A quote doc' }),
        doc('takeaway', null, { title: 'Zilch' }),
        doc('type', null, { title: 'Nada' }),
      ],
      extractions: [
        extraction('quote', { keyTakeaways: [takeaway('no', 'hit quote', 1)] }),
        extraction('item', { actionItems: [item('hit item', 'no', 1)] }),
        extraction('actquote', { actionItems: [item('no', 'hit actquote', 1)] }),
        extraction('takeaway', { keyTakeaways: [takeaway('hit takeaway', 'no')] }),
        extraction('type', { documentTypeLabel: 'A hit notice' }),
      ],
    });
    // 'actquote' and 'item' share tier 3 — 'actquote' orders first by name.
    expect(documents.map((r) => r.doc.id)).toEqual([
      'title',
      'type',
      'actquote',
      'item',
      'takeaway',
      'quote',
    ]);
  });

  it('within a tier, more term hits win, then the more recent Document', () => {
    const { documents } = build({
      query: 'hit me',
      documents: [
        doc('mid', null, {
          title: 'A hit me doc',
          createdAt: { seconds: 1_600_000_000, nanoseconds: 0 },
        }),
        doc('new', null, { title: 'A hit me doc' }),
        doc('many', null, { title: 'A hit me doc', originalFilename: 'hit-me.pdf' }),
        doc('deep', null, { title: 'Nothing' }),
        doc('old', null, {
          title: 'A hit me doc',
          createdAt: { seconds: 1_500_000_000, nanoseconds: 0 },
        }),
      ],
      extractions: [
        extraction('deep', {
          keyTakeaways: [takeaway('hit me twice', 'no'), takeaway('me too', 'no')],
        }),
      ],
    });
    // 'many' leads: its title+filename hits (4) outrank the plain titles' 2.
    // The plain titles order newest → oldest, and 'deep' trails at tier 4
    // despite its 3 hits — the tier outranks the hit count.
    expect(documents.map((r) => r.doc.id)).toEqual(['many', 'new', 'mid', 'old', 'deep']);
  });

  it('matches Folder names, keywords and descriptions — name matches outrank descriptions', () => {
    const { folders } = build({
      query: 'tax',
      folders: [
        folder('desc', 'Letters', null, { description: 'tax office correspondence' }),
        folder('named', 'Tax stuff', null),
        folder('keyed', 'Amt', null, { keywords: ['tax', 'bureaucracy'] }),
      ],
    });
    expect(folders.map((r) => r.folder.id)).toEqual(['named', 'keyed', 'desc']);
    expect(folders.map((r) => r.reasons)).toEqual([['Name'], ['Keywords'], ['Description']]);
    expect(snippetText(folders[1])).toBe('tax');
  });

  it('matches the Extraction document type by the shared display label', () => {
    const byEnum = build({
      query: 'tenancy agreement',
      documents: [doc('d1', null)],
      extractions: [extraction('d1', { documentType: 'TENANCY_AGREEMENT' })],
    });
    expect(byEnum.documents[0].reasons).toEqual(['Document type']);

    const byLabel = build({
      query: 'health insurance',
      documents: [doc('d1', null)],
      extractions: [
        extraction('d1', { documentType: 'OTHER', documentTypeLabel: 'Health insurance notice' }),
      ],
    });
    expect(snippetText(byLabel.documents[0])).toBe('Health insurance notice');
  });

  it('carries the cited page and quote on item and takeaway matches so a click can open at them', () => {
    const { documents } = build({
      query: 'notice writing',
      documents: [doc('d1', null)],
      extractions: [
        extraction('d1', {
          actionItems: [item('Notice must be given in writing', 'Schriftform', 3)],
          keyTakeaways: [takeaway('Repairs up to €100', 'Kleinreparaturen')],
        }),
      ],
    });
    expect(documents[0].reasons).toEqual(['Action item']);
    expect(documents[0].focus).toEqual({ page: 3, quote: 'Schriftform' });
  });

  it('offers no page jump when the best match cites no page — even if a deeper match does', () => {
    const { documents } = build({
      query: 'title hit',
      documents: [doc('d1', null, { title: 'Title hit doc' })],
      extractions: [
        extraction('d1', { actionItems: [item('no match', 'hit', 5)] }),
      ],
    });
    // 'title' hits tier 1, 'hit' hits the quote too — but AND needs both; the
    // best match is the title, which carries no focus.
    expect(documents[0].reasons[0]).toBe('Title');
    expect(documents[0].focus).toBeNull();
  });

  it('scopes candidates to the browsed Folder and below, with paths relative to it', () => {
    const folders = [
      folder('a', 'Verträge', null),
      folder('b', 'Wohnung', 'a'),
      folder('c', 'Other', null),
    ];
    const documents = [
      doc('inB', 'b', { title: 'Wohnung letter' }),
      doc('inC', 'c', { title: 'Wohnung letter two' }),
      doc('root', null, { title: 'Wohnung letter three' }),
    ];

    const scoped = build({
      query: 'wohnung',
      documents,
      folders,
      scopeFolderId: 'a',
      browsedFolderId: 'a',
    });
    expect(scoped.documents.map((r) => [r.doc.id, r.path])).toEqual([['inB', 'Wohnung']]);
    expect(scoped.folders.map((r) => [r.folder.id, r.path])).toEqual([['b', null]]);
  });

  it('the unscoped search covers the whole library and reports full paths', () => {
    const folders = [folder('a', 'Verträge', null), folder('b', 'Wohnung', 'a')];
    const { documents, folders: found } = build({
      query: 'wohnung',
      documents: [doc('inB', 'b', { title: 'Wohnung letter' })],
      folders,
      browsedFolderId: 'a',
    });
    expect(found.map((r) => [r.folder.id, r.path])).toEqual([['b', 'Verträge']]);
    expect(documents[0].path).toBe('Verträge / Wohnung');
  });

  it('never returns the browsed Folder itself, deleting Folders, or un-ready Documents', () => {
    const { folders, documents } = build({
      query: 'wohnung',
      folders: [
        folder('a', 'Wohnung', null),
        { ...folder('gone', 'Wohnung alt', null), status: 'deleting' as const },
        folder('doomed', 'Kept name', 'gone'),
        folder('b', 'Wohnung sub', 'a'),
      ],
      documents: [
        doc('gone-too', null, { title: 'Wohnung upload', status: 'uploading' }),
        doc('in-doomed', 'doomed', { title: 'Wohnung letter' }),
        doc('inB', 'b', { title: 'Wohnung letter' }),
      ],
      browsedFolderId: 'a',
    });
    // 'doomed' is ready but lives inside a deleting Folder — it leaves with it,
    // and so does the Document it holds (ADR 0005's recursive delete).
    expect(folders.map((r) => r.folder.id)).toEqual(['b']);
    expect(documents.map((r) => r.doc.id)).toEqual(['inB']);
  });

  it('dedupes repeated terms — "tax tax" is the same AND as "tax"', () => {
    const { folders } = build({ query: 'tax tax', folders: [folder('f', 'Tax stuff', null)] });
    expect(folders.map((r) => r.folder.id)).toEqual(['f']);
  });

  it('answers only from two characters up', () => {
    const one = build({ query: 'x', documents: [doc('d1', null, { title: 'x-ray' })] });
    expect(one).toEqual({ folders: [], documents: [] });
    const two = build({ query: 'x-', documents: [doc('d1', null, { title: 'x-ray' })] });
    expect(two.documents).toHaveLength(1);
  });

  it('splits the snippet at the matched terms and counts the rest as more matches', () => {
    const { documents } = build({
      query: 'kuendigung monate',
      documents: [doc('d1', null, { title: 'Contract' })],
      extractions: [
        extraction('d1', {
          actionItems: [item('Give notice', 'Die Kündigungsfrist beträgt drei Monate.', 3)],
        }),
      ],
    });
    // 'monate' only hits the quote; 'kuendigung' folds onto 'Kündigung…' —
    // both mark their original-text spans inside the snippet.
    expect(documents[0].snippet).toEqual([
      { text: 'Die ', hit: false },
      { text: 'Kündigung', hit: true },
      { text: 'sfrist beträgt drei ', hit: false },
      { text: 'Monate', hit: true },
      { text: '.', hit: false },
    ]);
    expect(documents[0].snippetLang).toBe('de');
  });

  it('reports further matched fields as "+N more"', () => {
    const { documents } = build({
      query: 'd1',
      documents: [doc('d1', null, { title: 'Title d1' })],
    });
    // Title and Filename both hit — the title is best, so the row shows no
    // snippet but still counts the other field.
    expect(documents[0].snippet).toBeNull();
    expect(documents[0].more).toBe(1);
  });

  it('returns empty sections for a blank query and for no matches', () => {
    const results = build({ query: '   ', documents: [doc('d1', null)] });
    expect(results).toEqual({ folders: [], documents: [] });
    expect(build({ query: 'zzz', documents: [doc('d1', null)] })).toEqual({
      folders: [],
      documents: [],
    });
  });
});
