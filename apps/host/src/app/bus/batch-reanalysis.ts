import {
  DestroyRef,
  Injectable,
  computed,
  effect,
  inject,
  signal,
  untracked,
  type Signal,
} from '@angular/core';
import { isOutdatedExtraction } from '@klartext/bus-contract';
import type { DocumentRecord } from '../data/document';
import { folderSubtree } from '../data/folder-tree';
import { LibraryStore } from '../library/library.store';
import { ToastService, type ToastAction } from '../toasts/toast.service';
import { ExtractionFlow, type BatchObserver } from './extraction-flow';

/** The Batch re-analysis criteria (ADR 0015). */
export type BatchCriterion = 'outdated' | 'failed' | 'all';

/** Each criterion's matching Documents over one scope. */
export type BatchCandidates = Record<BatchCriterion, DocumentRecord[]>;

/** The running batch's progress: `done` members settled of `total`. */
export interface BatchProgress {
  running: boolean;
  done: number;
  total: number;
}

interface BatchState {
  /** Members whose job has not settled yet — queued or running. */
  readonly pending: ReadonlySet<string>;
  readonly analyzed: readonly string[];
  readonly failed: readonly string[];
  /** Failures since the last success — the stop rule's counter. */
  readonly failureStreak: number;
}

const IDLE: BatchProgress = { running: false, done: 0, total: 0 };

/** A batch stops after this many failures in a row (ADR 0015). */
const MAX_FAILURE_STREAK = 3;

/**
 * Batch re-analysis (issue #158, ADR 0015): the user-initiated re-run of many
 * Documents' Extraction Jobs over a Folder scope. Never started by the Host.
 * Members are ordinary Extraction Jobs through `ExtractionFlow`'s retry path,
 * queued at `batch` priority behind upload and retry work. One batch at a
 * time; nothing is persisted — a reload ends the batch, and the criteria
 * (per-Document state) pick up the remainder on the next run.
 */
@Injectable()
export class BatchReanalysis implements BatchObserver {
  private readonly store = inject(LibraryStore);
  private readonly flow = inject(ExtractionFlow);
  private readonly toasts = inject(ToastService);

  private readonly state = signal<BatchState | null>(null);
  /**
   * Members of an ended batch whose job was already running — they finish
   * and persist, still without per-Document toasts.
   */
  private readonly draining = new Set<string>();

  constructor() {
    this.flow.observeBatch(this);
    inject(DestroyRef).onDestroy(() => this.flow.observeBatch(null));
    // A member deleted mid-batch never settles — forget it, don't wait.
    effect(() => {
      const documents = this.store.documents() ?? [];
      untracked(() => this.forgetGone(documents));
    });
  }

  /**
   * A cancelled batch still waiting on the member it had already started —
   * the strip reads "Finishing the current document…" until it settles.
   */
  readonly finishing = signal(false);

  /** The running batch's progress — `running: false` while idle. */
  readonly progress = computed<BatchProgress>(() => {
    const state = this.state();
    if (state === null) return IDLE;
    const done = state.analyzed.length + state.failed.length;
    return { running: true, done, total: done + state.pending.size };
  });

  /**
   * The criteria over `scope` — a Folder id and everything nested in it, or
   * the whole library at root (`null`) — as signals over the library and the
   * Extraction index (ADR 0011). `null` until the index is complete. Only
   * ready Documents with an Extraction or a recorded failure qualify:
   * in-flight ones are already on the queue, and never-analyzed ones
   * auto-enqueue on load.
   *
   * - `outdated` — the stored Extraction is an Outdated Extraction.
   * - `failed` — Couldn't analyze: a recorded failure and no Extraction.
   * - `all` — every qualifying Document.
   */
  candidates(scope: string | null): Signal<BatchCandidates | null> {
    return computed(() => {
      if (!this.store.extractionsLoaded()) return null;
      const documents = this.store.documents() ?? [];
      const inScope =
        scope === null
          ? documents
          : folderSubtree(this.store.folders() ?? [], documents, scope).documents;
      const jobs = this.store.extractionJobs();
      const extractions = this.store.extractionsByDocId();
      const result: BatchCandidates = { outdated: [], failed: [], all: [] };
      for (const doc of inScope) {
        const job = jobs.get(doc.id);
        if (doc.status !== 'ready' || job === 'queued' || job === 'running') continue;
        const extraction = extractions.get(doc.id);
        if (extraction) {
          result.all.push(doc);
          if (isOutdatedExtraction(extraction)) result.outdated.push(doc);
        } else if (doc.extractionFailure) {
          result.all.push(doc);
          result.failed.push(doc);
        }
      }
      return result;
    });
  }

  /**
   * Starts a batch over `criterion`'s matches in `scope`. Returns `false`
   * when refused: a batch is already running, the index isn't loaded, or
   * nothing matches.
   */
  start(scope: string | null, criterion: BatchCriterion): boolean {
    const members = untracked(() => this.candidates(scope)())?.[criterion] ?? [];
    return this.run(members.map((d) => d.id));
  }

  /**
   * Cancels the running batch: every unstarted member is dropped from the
   * queue (a Couldn't-analyze member keeps its failure record); the running
   * job finishes and persists. Upload jobs and other work are untouched.
   */
  cancel(): void {
    const state = this.state();
    if (state === null) return;
    const total = state.analyzed.length + state.failed.length + state.pending.size;
    this.end(state);
    this.finishing.set(this.draining.size > 0);
    this.toasts.show({
      tone: 'info',
      title: 'Re-analysis cancelled',
      body: `${state.analyzed.length} of ${total} done.`,
      ...(state.failed.length > 0 ? { action: this.retry(state.failed) } : {}),
    });
  }

  // -- BatchObserver ---------------------------------------------------------

  isMember(documentId: string): boolean {
    return (this.state()?.pending.has(documentId) ?? false) || this.draining.has(documentId);
  }

  settled(documentId: string, analyzed: boolean): void {
    if (this.draining.delete(documentId)) {
      this.finishing.set(this.finishing() && this.draining.size > 0);
      return;
    }
    const state = this.state();
    if (!state?.pending.has(documentId)) return;
    const pending = new Set(state.pending);
    pending.delete(documentId);
    const next: BatchState = {
      pending,
      analyzed: analyzed ? [...state.analyzed, documentId] : state.analyzed,
      failed: analyzed ? state.failed : [...state.failed, documentId],
      failureStreak: analyzed ? 0 : state.failureStreak + 1,
    };
    if (pending.size === 0) {
      this.state.set(null);
      this.summarize(next);
    } else if (next.failureStreak >= MAX_FAILURE_STREAK) {
      this.stop(next);
    } else {
      this.state.set(next);
    }
  }

  // -- helpers ----------------------------------------------------------------

  private run(documentIds: readonly string[]): boolean {
    if (this.state() !== null) return false;
    const pending = new Set(documentIds.filter((id) => this.flow.reanalyze(id, 'batch')));
    if (pending.size === 0) return false;
    this.state.set({ pending, analyzed: [], failed: [], failureStreak: 0 });
    return true;
  }

  /** Drops members no longer `ready` in the library; the rest carry on. */
  private forgetGone(documents: readonly DocumentRecord[]): void {
    const ready = new Set(documents.filter((d) => d.status === 'ready').map((d) => d.id));
    for (const id of this.draining) if (!ready.has(id)) this.draining.delete(id);
    if (this.draining.size === 0) this.finishing.set(false);
    const state = this.state();
    if (state === null || [...state.pending].every((id) => ready.has(id))) return;
    const next = { ...state, pending: new Set([...state.pending].filter((id) => ready.has(id))) };
    if (next.pending.size > 0) {
      this.state.set(next);
      return;
    }
    this.state.set(null);
    if (next.analyzed.length + next.failed.length > 0) this.summarize(next);
  }

  /**
   * Ends the batch: every unstarted member is dropped from the queue; a
   * running one finishes and persists. Returns the dropped ids.
   */
  private end(state: BatchState): string[] {
    this.state.set(null);
    const unstarted: string[] = [];
    for (const id of state.pending) {
      if (this.flow.cancelReanalysis(id)) unstarted.push(id);
      else this.draining.add(id);
    }
    return unstarted;
  }

  /** The AI looks unavailable — stop rather than fail every remaining member. */
  private stop(state: BatchState): void {
    const total = state.analyzed.length + state.failed.length + state.pending.size;
    const unstarted = this.end(state);
    this.toasts.show({
      tone: 'error',
      title: 'Re-analysis stopped',
      body: `AI is unavailable right now. ${state.analyzed.length} of ${total} done.`,
      action: this.retry([...state.failed, ...unstarted]),
    });
  }

  /** The one toast a finished batch raises; Try again re-runs only failures. */
  private summarize({ analyzed, failed }: BatchState): void {
    const total = analyzed.length + failed.length;
    if (failed.length === 0) {
      this.toasts.show({ tone: 'success', title: `Re-analyzed ${documentCount(total)}` });
      return;
    }
    this.toasts.show({
      tone: 'error',
      title: `Re-analyzed ${analyzed.length} of ${total}`,
      body: `${failed.length} couldn't be analyzed`,
      action: this.retry(failed),
    });
  }

  private retry(documentIds: readonly string[]): ToastAction {
    return { label: 'Try again', run: () => void this.run(documentIds) };
  }
}

function documentCount(count: number): string {
  return `${count} document${count === 1 ? '' : 's'}`;
}
