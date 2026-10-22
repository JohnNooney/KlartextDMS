import type { ActionTiming, ExtractionRecord, NoticeUnit } from '@klartext/bus-contract';
import type { DocumentRecord } from '../data/document';
import { folderAncestry, type FolderRecord } from '../data/folder';

export type AttentionGroupKey = 'overdue' | 'thisWeek' | 'later' | 'noDate';

/** One Action Item as the Folder attention overview lists it (issue #120). */
export interface AttentionItem {
  id: string;
  text: string;
  documentId: string;
  documentTitle: string;
  /** Folder path below the browsed Folder, `null` for Documents filed directly in it. */
  path: string | null;
  page?: number;
  sourceQuote: string;
  /** The human timing label: "Due in 4 days", "Monthly by the 3rd", "3 months’ notice · moving out". */
  timingLabel: string;
}

export interface AttentionGroup {
  key: AttentionGroupKey;
  label: string;
  items: AttentionItem[];
}

export interface AttentionOverviewInput {
  /** The ready Documents under the browsed Folder, from `readyDocumentsInScope`. */
  scoped: readonly ScopedDocument[];
  extractions: ReadonlyMap<string, ExtractionRecord>;
  today: Date;
}

export interface ScopedDocument {
  doc: DocumentRecord;
  /** Folder path below the browsed Folder; `null` when filed directly in it. */
  path: string | null;
}

const GROUPS: { key: AttentionGroupKey; label: string }[] = [
  { key: 'overdue', label: 'Overdue' },
  { key: 'thisWeek', label: 'This week' },
  { key: 'later', label: 'Later' },
  { key: 'noDate', label: 'No date' },
];

const WEEK_DAYS = 7;
const NOTICE_UNITS: Record<NoticeUnit, string> = {
  DAYS: 'day',
  WEEKS: 'week',
  MONTHS: 'month',
  YEARS: 'year',
};
const DAY_MS = 86_400_000;

/**
 * The Folder attention overview's read model (ADR 0011): every Action Item
 * of the ready Documents under the browsed Folder at any depth (ADR 0005),
 * grouped by urgency with each item's folder path relative to that Folder.
 */
export function buildAttentionOverview(input: AttentionOverviewInput): AttentionGroup[] {
  const { scoped, extractions, today } = input;
  const entries: { key: AttentionGroupKey; item: AttentionItem; due: number | null }[] = [];
  for (const { doc, path } of scoped) {
    const extraction = extractions.get(doc.id);
    if (!extraction) continue;
    for (const action of extraction.actionItems) {
      const { key, timingLabel, due } = classify(action.timing, today);
      entries.push({
        key,
        due,
        item: {
          id: action.id,
          text: action.text,
          documentId: doc.id,
          documentTitle: doc.title,
          path,
          page: action.page,
          sourceQuote: action.sourceQuote,
          timingLabel,
        },
      });
    }
  }
  return GROUPS.map(({ key, label }) => ({
    key,
    label,
    items: entries
      .filter((e) => e.key === key)
      .sort(compareByDue)
      .map((e) => e.item),
  })).filter((group) => group.items.length > 0);
}

/**
 * The `ready` Documents under the browsed Folder at any depth (ADR 0005) with
 * their folder path below it — also the denominator of "Reading n of m".
 */
export function readyDocumentsInScope(
  documents: readonly DocumentRecord[],
  folders: readonly FolderRecord[],
  scopeFolderId: string | null,
): ScopedDocument[] {
  const scoped: ScopedDocument[] = [];
  for (const doc of documents) {
    if (doc.status !== 'ready') continue;
    const chain = folderAncestry(folders, doc.folderId);
    const start = scopeFolderId === null ? 0 : chain.findIndex((f) => f.id === scopeFolderId) + 1;
    if (scopeFolderId !== null && start === 0) continue;
    scoped.push({ doc, path: chain.slice(start).map((f) => f.name).join(' / ') || null });
  }
  return scoped;
}

/** Dated items first by due date then Document title; undated items keep feed order. */
function compareByDue(a: { due: number | null; item: AttentionItem }, b: typeof a): number {
  if (a.due === null || b.due === null) return a.due === b.due ? 0 : a.due === null ? 1 : -1;
  return a.due - b.due || a.item.documentTitle.localeCompare(b.item.documentTitle);
}

function classify(
  timing: ActionTiming,
  today: Date,
): { key: AttentionGroupKey; timingLabel: string; due: number | null } {
  switch (timing.kind) {
    case 'FIXED_DATE': {
      const [y, m, d] = timing.dueDate.split('-').map(Number);
      const due = Date.UTC(y, m - 1, d);
      const days = Math.round((due - Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) / DAY_MS);
      const key = days < 0 ? 'overdue' : days <= WEEK_DAYS ? 'thisWeek' : 'later';
      return { key, due, timingLabel: dueLabel(days, due) };
    }
    case 'RECURRING':
      return { key: 'later', due: null, timingLabel: timing.scheduleLabel };
    case 'NOTICE_PERIOD': {
      const unit = NOTICE_UNITS[timing.unit];
      return {
        key: 'later',
        due: null,
        timingLabel: `${timing.duration} ${unit}${timing.duration === 1 ? '' : 's'}’ notice · ${timing.anchor}`,
      };
    }
    case 'NONE':
      return { key: 'noDate', due: null, timingLabel: 'No date' };
  }
}

function dueLabel(days: number, due: number): string {
  if (days === 0) return 'Due today';
  if (days === -1) return 'Due yesterday';
  if (days < 0) return `Due ${-days} days ago`;
  if (days === 1) return 'Due tomorrow';
  if (days <= WEEK_DAYS) return `Due in ${days} days`;
  return `Due ${new Date(due).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}`;
}
