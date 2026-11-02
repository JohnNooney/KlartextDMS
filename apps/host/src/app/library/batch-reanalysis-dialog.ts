import { Component, computed, input, output, signal } from '@angular/core';
import type { BatchCandidates, BatchCriterion } from '../bus/batch-reanalysis';
import type { DocumentRecord } from '../data/document';
import { folderAncestry, type FolderRecord } from '../data/folder';
import { ModalSurface } from './modal-surface';

interface CriterionRow {
  key: BatchCriterion;
  label: string;
  hint: string;
}

/** The radio rows, in default-selection order (issue #159). */
const CRITERIA: readonly CriterionRow[] = [
  {
    key: 'outdated',
    label: 'Outdated format',
    hint: 'Analyzed in an earlier format — no dates on Action Items.',
  },
  { key: 'failed', label: "Couldn't analyze", hint: 'The last analysis failed.' },
  { key: 'all', label: 'All documents', hint: 'Every analyzed document, including up-to-date ones.' },
];

/** Above this many members the dialog warns about time and AI quota. */
const LARGE_BATCH = 50;

/**
 * The Batch re-analysis dialog (issue #159, ADR 0015): pick a criterion over
 * the browsed Folder's subtree (the whole library at root) and start the
 * batch. Counts are live; a criterion with no matches can't be picked, and
 * the default is the first that has any — Outdated, then Couldn't analyze,
 * then All. Warns when members carry Done marks (#144) and when the batch
 * is large.
 */
@Component({
  selector: 'app-batch-reanalysis-dialog',
  templateUrl: './batch-reanalysis-dialog.html',
  styleUrls: ['./dialogs.scss', './batch-reanalysis-dialog.scss'],
  imports: [ModalSurface],
})
export class BatchReanalysisDialog {
  readonly candidates = input.required<BatchCandidates>();
  /** The scope's Folder — `null` at root. */
  readonly scope = input<FolderRecord | null>(null);
  readonly folders = input<readonly FolderRecord[]>([]);
  readonly started = output<BatchCriterion>();
  readonly closed = output<void>();

  protected readonly criteria = CRITERIA;
  protected readonly largeBatch = LARGE_BATCH;
  private readonly picked = signal<BatchCriterion | null>(null);
  protected readonly listOpen = signal(false);

  protected readonly selected = computed<BatchCriterion | null>(() => {
    const candidates = this.candidates();
    const picked = this.picked();
    if (picked !== null && candidates[picked].length > 0) return picked;
    return CRITERIA.find(({ key }) => candidates[key].length > 0)?.key ?? null;
  });

  protected readonly members = computed(() => {
    const selected = this.selected();
    return selected === null ? [] : this.candidates()[selected];
  });

  protected readonly withDone = computed(
    () => this.members().filter((doc) => doneCount(doc) > 0).length,
  );

  protected readonly doneCount = doneCount;
  protected readonly plural = documentCount;

  protected count(criterion: BatchCriterion): number {
    return this.candidates()[criterion].length;
  }

  protected pick(criterion: BatchCriterion): void {
    this.picked.set(criterion);
  }

  /** The member's Folder path below the scope — "Nebenkosten › 2025"; empty when directly in it. */
  protected relativePath(doc: DocumentRecord): string {
    const chain = folderAncestry(this.folders(), doc.folderId);
    const scopeId = this.scope()?.id;
    const below = scopeId === undefined ? chain : chain.slice(chain.findIndex((f) => f.id === scopeId) + 1);
    return below.map((f) => f.name).join(' › ');
  }

  protected start(): void {
    const selected = this.selected();
    if (selected !== null) this.started.emit(selected);
  }
}

function doneCount(doc: DocumentRecord): number {
  return Object.keys(doc.actionItemStates ?? {}).length;
}

function documentCount(count: number): string {
  return `${count} document${count === 1 ? '' : 's'}`;
}
