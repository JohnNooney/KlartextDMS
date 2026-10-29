import {
  actionUrgency,
  isDone,
  URGENCY_LABELS,
  type ExtractionRecord,
  type Urgency,
} from '@klartext/bus-contract';
import type { DocumentRecord } from '../data/document';
import { folderAncestry, type FolderRecord } from '../data/folder';

/** The overview groups by the shared Urgency buckets (ADR 0012). */
export type AttentionGroupKey = Urgency;

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
  /** The shared timing label (ADR 0012): "Due in 4 days", "Monthly by the 3rd", "3 months’ notice · moving out"; `null` when undated. */
  timingLabel: string | null;
}

export interface AttentionGroup {
  key: AttentionGroupKey;
  label: string;
  items: AttentionItem[];
}

/**
 * The overview read model (issue #144): the Urgency groups hold pending
 * items only — Done items (ADR 0013) are hidden from the card and its
 * count, and collect in `done` for the See All sheet's collapsed group.
 */
export interface AttentionOverview {
  groups: AttentionGroup[];
  done: AttentionItem[];
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

const GROUPS: readonly Urgency[] = ['overdue', 'thisWeek', 'later', 'noDate'];

/**
 * The Folder attention overview's read model (ADR 0011): every Action Item
 * of the ready Documents under the browsed Folder at any depth (ADR 0005),
 * grouped by Urgency with each item's folder path relative to that Folder.
 */
export function buildAttentionOverview(input: AttentionOverviewInput): AttentionOverview {
  const { scoped, extractions, today } = input;
  const entries: { key: Urgency; item: AttentionItem; due: string | null }[] = [];
  const done: AttentionItem[] = [];
  for (const { doc, path } of scoped) {
    const extraction = extractions.get(doc.id);
    if (!extraction) continue;
    for (const action of extraction.actionItems) {
      const { urgency, label: timingLabel, dueDate } = actionUrgency(action.timing, today);
      const item: AttentionItem = {
        id: action.id,
        text: action.text,
        documentId: doc.id,
        documentTitle: doc.title,
        path,
        page: action.page,
        sourceQuote: action.sourceQuote,
        timingLabel,
      };
      // The Done mark rides on the DocumentRecord (ADR 0013) — isDone is
      // the single definition, shared with the Guest's list.
      if (isDone(action, doc.actionItemStates?.[action.id], today)) {
        done.push(item);
      } else {
        entries.push({ key: urgency, due: dueDate, item });
      }
    }
  }
  const groups = GROUPS.map((key) => ({
    key,
    label: URGENCY_LABELS[key],
    items: entries
      .filter((e) => e.key === key)
      .sort(compareByDue)
      .map((e) => e.item),
  })).filter((group) => group.items.length > 0);
  return { groups, done };
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
    // A Document inside a Folder that's deleting is leaving with it.
    if (chain.some((f) => f.status !== 'ready')) continue;
    const path = pathBelowScope(chain, scopeFolderId);
    if (path === undefined) continue;
    scoped.push({ doc, path });
  }
  return scoped;
}

/**
 * Where an entry sits below the scope Folder: `null` when it lives directly
 * in it, its ancestor names joined otherwise — `undefined` when it lies
 * outside the scope's subtree entirely. The `chain` is the entry's ancestor
 * Folders, outermost first, as `folderAncestry` returns them.
 */
export function pathBelowScope(
  chain: readonly FolderRecord[],
  scopeFolderId: string | null,
): string | null | undefined {
  const start = scopeFolderId === null ? 0 : chain.findIndex((f) => f.id === scopeFolderId) + 1;
  if (scopeFolderId !== null && start === 0) return undefined;
  return chain.slice(start).map((f) => f.name).join(' / ') || null;
}

/** Dated items first by due date then Document title; undated items keep feed order. */
function compareByDue(a: { due: string | null; item: AttentionItem }, b: typeof a): number {
  if (a.due === null || b.due === null) return a.due === b.due ? 0 : a.due === null ? 1 : -1;
  return a.due.localeCompare(b.due) || a.item.documentTitle.localeCompare(b.item.documentTitle);
}

