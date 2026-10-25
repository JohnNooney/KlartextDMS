import {
  documentTypeLabel,
  type ExtractionRecord,
  type GuestShowPagePayload,
} from '@klartext/bus-contract';
import type { DocumentRecord } from '../data/document';
import { folderAncestry, type FolderRecord } from '../data/folder';
import { compareNames } from '../data/folder-tree';
import { pathBelowScope, readyDocumentsInScope } from './attention-overview';

/**
 * Library search (issue #121, decision #103): a hand-rolled read model over
 * the Documents, Folders and the `extractionsByDocId` index already in memory
 * (ADR 0011) — no backend, no fuzzy matching. The query is whitespace-split
 * and ANDed term-wise (every folded term must hit some field), fields are
 * substring-matched after diacritic folding (so "Kaution" and "kuendigung"
 * both find the German paperwork), and ranking follows the decision's fixed
 * field tiers — within a tier, more term hits first, then recency:
 *
 *   1 titles/names · 2 keywords/type · 3 Action Item text and quotes
 *   4 takeaways/summary · 5 Folder descriptions, Key Takeaway quotes
 *
 * Each result carries its matched fields' reasons (the row's badges), the
 * best field's text as a highlighted snippet, the count of further matches
 * ("+N more") and, when that field cites a passage, the `{page, quote}` a
 * click-through lands via `PageFocus`.
 */

/** Why a result matched — the reason badge the result row wears. */
export type SearchReason =
  | 'Title'
  | 'Filename'
  | 'Name'
  | 'Keywords'
  | 'Document type'
  | 'Action item'
  | 'Key takeaway'
  | 'Summary'
  | 'Description'
  | 'Quote';

/** The fixed ranking tiers (decision #103) — lower sorts first. */
const TIER = {
  /** Document title/filename, Folder name. */
  TITLE: 1,
  /** Folder keywords, Extraction Document type. */
  KEYWORD: 2,
  /** Action Item text and sourceQuote. */
  ACTION_ITEM: 3,
  /** Key Takeaway text, plain-English summary. */
  TAKEAWAY: 4,
  /** Folder description, Key Takeaway sourceQuotes. */
  DETAIL: 5,
} as const;

interface SearchMatch {
  reason: SearchReason;
  tier: number;
  /** How many query terms this field hit — the "more matched terms" rank. */
  hits: number;
  /** The matched field's text — the result row's snippet. */
  text: string;
  /** The cited passage to open at, when the match carries one. */
  focus?: GuestShowPagePayload;
}

/** A span of the best match's text — `hit` marks the matched term's range. */
export interface SnippetSegment {
  text: string;
  hit: boolean;
}

interface SearchResultBase {
  /** The result's Folder path below the searched scope; `null` when it sits directly in it. */
  path: string | null;
  /** One badge per distinct matched field kind, best tier first. */
  reasons: SearchReason[];
  /**
   * The best match's field text split at the matched terms — `null` when the
   * title/name itself matched (the row already shows it). German `lang` is
   * set only for Quote snippets — the Document's own words.
   */
  snippet: SnippetSegment[] | null;
  snippetLang: 'de' | null;
  /** The further matched fields beyond the snippet's — the "+N more" hint. */
  more: number;
}

export interface FolderSearchResult extends SearchResultBase {
  kind: 'folder';
  folder: FolderRecord;
}

export interface DocumentSearchResult extends SearchResultBase {
  kind: 'document';
  doc: DocumentRecord;
  /** The best match's cited passage — `null` when it has none. */
  focus: GuestShowPagePayload | null;
}

export interface SearchResults {
  folders: FolderSearchResult[];
  documents: DocumentSearchResult[];
}

export interface SearchInput {
  query: string;
  documents: readonly DocumentRecord[];
  folders: readonly FolderRecord[];
  extractions: ReadonlyMap<string, ExtractionRecord>;
  /** `null` = the "All documents" scope; otherwise only the Folder's subtree counts. */
  scopeFolderId: string | null;
  /** The Folder being browsed — excluded from Folder results (you're already here). */
  browsedFolderId: string | null;
}

export function buildSearchResults(input: SearchInput): SearchResults {
  const empty: SearchResults = { folders: [], documents: [] };
  // The field starts answering at two characters (decision #103).
  if (input.query.trim().length < 2) return empty;
  const terms = [...new Set(fold(input.query).split(/\s+/).filter(Boolean))];
  if (terms.length === 0) return empty;

  const folders = foldersInScope(input.folders, input.scopeFolderId, input.browsedFolderId)
    .map(({ folder, path }) => ({ folder, path, matches: collect(terms, folderFields(folder)) }))
    .filter((r): r is typeof r & { matches: SearchMatch[] } => r.matches !== null)
    .sort(
      (a, b) =>
        a.matches[0].tier - b.matches[0].tier ||
        hits(b) - hits(a) ||
        recency(b.folder) - recency(a.folder) ||
        compareNames(a.folder.name, b.folder.name),
    )
    .map(({ folder, path, matches }) => ({
      kind: 'folder' as const,
      folder,
      path,
      ...present(matches, terms),
    }));

  const documents = readyDocumentsInScope(input.documents, input.folders, input.scopeFolderId)
    .map(({ doc, path }) => ({
      doc,
      path,
      matches: collect(terms, documentFields(doc, input.extractions.get(doc.id))),
    }))
    .filter((r): r is typeof r & { matches: SearchMatch[] } => r.matches !== null)
    .sort(
      (a, b) =>
        a.matches[0].tier - b.matches[0].tier ||
        hits(b) - hits(a) ||
        recency(b.doc) - recency(a.doc) ||
        compareNames(a.doc.title, b.doc.title),
    )
    .map(({ doc, path, matches }) => ({
      kind: 'document' as const,
      doc,
      path,
      focus: matches[0].focus ?? null,
      ...present(matches, terms),
    }));

  return { folders, documents };
}

/** The result's total term-field hits — the tier's "more matched terms" rank. */
function hits(result: { matches: SearchMatch[] }): number {
  return result.matches.reduce((n, m) => n + m.hits, 0);
}

function recency(entry: { createdAt: { seconds: number; nanoseconds: number } }): number {
  return entry.createdAt.seconds + entry.createdAt.nanoseconds / 1e9;
}

interface Field {
  reason: SearchReason;
  tier: number;
  text: string | undefined;
  focus?: GuestShowPagePayload;
}

/** A Folder's searchable fields: name, keywords, description (ADR 0005; issue #103's fog item). */
function folderFields(folder: FolderRecord): Field[] {
  return [
    { reason: 'Name', tier: TIER.TITLE, text: folder.name },
    ...(folder.keywords ?? []).map(
      (keyword): Field => ({ reason: 'Keywords', tier: TIER.KEYWORD, text: keyword }),
    ),
    { reason: 'Description', tier: TIER.DETAIL, text: folder.description },
  ];
}

/** A Document's searchable fields: title/filename, then its Extraction's. */
function documentFields(doc: DocumentRecord, extraction?: ExtractionRecord): Field[] {
  const fields: Field[] = [
    { reason: 'Title', tier: TIER.TITLE, text: doc.title },
    { reason: 'Filename', tier: TIER.TITLE, text: doc.originalFilename },
  ];
  if (!extraction) return fields;
  const focus = (page: number | undefined, quote: string): GuestShowPagePayload | undefined =>
    page === undefined ? undefined : { page, quote };
  fields.push(
    { reason: 'Document type', tier: TIER.KEYWORD, text: documentTypeLabel(extraction) },
    { reason: 'Summary', tier: TIER.TAKEAWAY, text: extraction.plainEnglishSummary },
    ...extraction.actionItems.flatMap(
      (item): Field[] => [
        {
          reason: 'Action item',
          tier: TIER.ACTION_ITEM,
          text: item.text,
          focus: focus(item.page, item.sourceQuote),
        },
        {
          reason: 'Quote',
          tier: TIER.ACTION_ITEM,
          text: item.sourceQuote,
          focus: focus(item.page, item.sourceQuote),
        },
      ],
    ),
    ...extraction.keyTakeaways.flatMap(
      (item): Field[] => [
        {
          reason: 'Key takeaway',
          tier: TIER.TAKEAWAY,
          text: item.text,
          focus: focus(item.page, item.sourceQuote),
        },
        {
          reason: 'Quote',
          tier: TIER.DETAIL,
          text: item.sourceQuote,
          focus: focus(item.page, item.sourceQuote),
        },
      ],
    ),
  );
  return fields;
}

/**
 * The ready Folders below `scopeFolderId` (all of them when `null`), each with
 * its path relative to the scope. The browsed Folder itself is never a result,
 * nor is anything inside a Folder that's deleting (ADR 0005's recursive delete).
 */
function foldersInScope(
  folders: readonly FolderRecord[],
  scopeFolderId: string | null,
  browsedFolderId: string | null,
): { folder: FolderRecord; path: string | null }[] {
  const scoped: { folder: FolderRecord; path: string | null }[] = [];
  for (const folder of folders) {
    if (folder.status !== 'ready' || folder.id === browsedFolderId) continue;
    // The Folder's own ancestry describes where it lives — itself excluded.
    const chain = folderAncestry(folders, folder.parentId);
    if (chain.some((f) => f.status !== 'ready')) continue;
    const path = pathBelowScope(chain, scopeFolderId);
    if (path === undefined) continue;
    scoped.push({ folder, path });
  }
  return scoped;
}

/** Every term must hit some field; returns the matched fields tier-sorted, or null. */
function collect(terms: readonly string[], fields: Field[]): SearchMatch[] | null {
  const satisfied = new Set<string>();
  const matches: SearchMatch[] = [];
  for (const field of fields) {
    if (field.text === undefined) continue;
    const folded = fold(field.text);
    const hits = terms.filter((term) => folded.includes(term));
    if (hits.length === 0) continue;
    for (const term of hits) satisfied.add(term);
    matches.push({
      reason: field.reason,
      tier: field.tier,
      hits: hits.length,
      text: field.text,
      focus: field.focus,
    });
  }
  if (satisfied.size !== terms.length) return null;
  matches.sort((a, b) => a.tier - b.tier);
  return matches;
}

/** Reasons deduplicated, the best match's text as highlighted segments — the row's presentation. */
function present(
  matches: SearchMatch[],
  terms: readonly string[],
): Pick<SearchResultBase, 'reasons' | 'snippet' | 'snippetLang' | 'more'> {
  const best = matches[0];
  const titled = best.reason === 'Title' || best.reason === 'Name';
  return {
    reasons: [...new Set(matches.map((m) => m.reason))],
    snippet: titled ? null : highlight(best.text, terms),
    snippetLang: !titled && best.reason === 'Quote' ? 'de' : null,
    more: matches.length - 1,
  };
}

/**
 * The field text as segments, with the folded terms' spans marked — folded
 * positions are mapped back through `foldMapped`, so "Kündigung" highlights
 * under a folded "kundigung" or transliterated "kuendigung" query alike.
 */
function highlight(text: string, terms: readonly string[]): SnippetSegment[] {
  const { folded, map } = foldMapped(text);
  const ranges: [number, number][] = [];
  for (const term of terms) {
    for (let at = folded.indexOf(term); at !== -1; at = folded.indexOf(term, at + 1)) {
      ranges.push([map[at][0], map[at + term.length - 1][1]]);
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const segments: SnippetSegment[] = [];
  let at = 0;
  for (const [start, end] of ranges) {
    if (end <= at) continue;
    if (start > at) segments.push({ text: text.slice(at, start), hit: false });
    segments.push({ text: text.slice(Math.max(start, at), end), hit: true });
    at = end;
  }
  if (at < text.length) segments.push({ text: text.slice(at), hit: false });
  return segments;
}

/**
 * `fold` with a source map: `map[i]` is the original-text range the i-th
 * folded character came from, so folded-term offsets translate back into
 * highlight ranges on the untransformed text.
 */
function foldMapped(text: string): { folded: string; map: [number, number][] } {
  const chars: string[] = [];
  const map: [number, number][] = [];
  let at = 0;
  for (const char of text) {
    const start = at;
    at += char.length;
    const base = char.normalize('NFD').toLowerCase();
    if (base === 'ß') {
      chars.push('s', 's');
      map.push([start, at], [start, at]);
      continue;
    }
    for (const piece of base) {
      if (/\p{M}/u.test(piece)) continue;
      chars.push(piece);
      map.push([start, at]);
    }
  }
  // The English-keyboard spellings NFD doesn't reach: ae/oe/ue collapse like
  // the umlaut they stand for — "kuendigung" finds "Kündigung" too.
  const folded: string[] = [];
  const foldedMap: [number, number][] = [];
  for (let i = 0; i < chars.length; i++) {
    const pair = chars[i] + (chars[i + 1] ?? '');
    if (pair === 'ae' || pair === 'oe' || pair === 'ue') {
      folded.push(chars[i]);
      foldedMap.push([map[i][0], map[i + 1][1]]);
      i++;
    } else {
      folded.push(chars[i]);
      foldedMap.push(map[i]);
    }
  }
  return { folded: folded.join(''), map: foldedMap };
}

/**
 * Diacritic folding (decision #103): lowercase, NFD-decompose, strip the
 * combining marks — "Kündigung" and "kundigung" fold alike — plus ß→ss and
 * ae/oe/ue→a/o/u so "strasse" finds "Straße" and "kuendigung" finds
 * "Kündigung". Applied to both query and fields, the folds stay symmetric.
 */
function fold(text: string): string {
  return foldMapped(text).folded;
}
