import { DestroyRef, Injectable, effect, inject, untracked } from '@angular/core';
import { doneMark, normalizeExtractionRecord } from '@klartext/bus-contract';
import type {
  ActionItemDoneRequest,
  ActionItemStates,
  ExtractionCandidate,
  ExtractionError,
  ExtractionRecord,
  ExtractionState,
  GuestShowPagePayload,
  JobDocument,
  ReminderRequest,
  Session,
  SessionUser,
} from '@klartext/bus-contract';
import { AuthService } from '../auth.service';
import type { DocumentRecord } from '../data/document';
import type { DocumentRepository } from '../data/document-repository';
import type { ExtractionRepository } from '../data/extraction-repository';
import { DOCUMENT_REPOSITORY, EXTRACTION_REPOSITORY } from '../data/providers';
import { LibraryStore, type ExtractionJobState } from '../library/library.store';
import { OpenDocument } from '../open-document';
import { PageFocus } from '../page-focus';
import { Reminders } from '../reminders/reminders';
import { SheetExpand } from '../sheet-expand';
import { ToastService } from '../toasts/toast.service';
import { HostBus } from './host-bus';
import { HostBusEvents } from './host-bus-events';
import type { HostBusProbe } from './host-bus.adapter';

/** What the panel is presumed to show — resends only on a real change. */
interface SentSession {
  documentId: string;
  documentTitle: string;
  extractionState: ExtractionState;
  extraction: ExtractionRecord | null;
}

/**
 * Session flow and Extraction Job orchestration across the Bus (issue #31,
 * ADRs 0003/0008). Scoped to the signed-in data layer: created with the
 * library's providers, attaches itself to `HostBusEvents` as the outcome
 * delegate, and owns three flows —
 *
 * - Sessions: the open Document produces `INIT_SESSION` (stored Extraction +
 *   `extractionState`) under a fresh `sessionId` whenever the sent state
 *   would change; the adapter resends itself on job completion, so the flow
 *   records that resend and never double-sends.
 * - The job queue's feeders: `uploading → ready` transitions, and on load
 *   every ready Document with no Extraction and no recorded failure — a
 *   recorded failure is never auto-requeued (`running` is never persisted).
 * - Outcomes: success is persisted at `extractions/current` (the adapter has
 *   already validated the candidate); failure is recorded on the Document;
 *   `RETRY_EXTRACTION` clears the record and re-enqueues with fresh bytes.
 */
@Injectable()
export class ExtractionFlow implements HostBusProbe {
  private readonly documents: DocumentRepository = inject(DOCUMENT_REPOSITORY);
  private readonly extractions: ExtractionRepository = inject(EXTRACTION_REPOSITORY);
  private readonly store = inject(LibraryStore);
  private readonly open = inject(OpenDocument);
  private readonly pageFocus = inject(PageFocus);
  private readonly sheetExpand = inject(SheetExpand);
  private readonly reminders = inject(Reminders);
  private readonly auth = inject(AuthService);
  private readonly bus = inject(HostBus);
  private readonly toasts = inject(ToastService);

  /** Ready Documents the auto-enqueue rule already handled this load. */
  private readonly handled = new Set<string>();
  private swept = false;
  private lastSent: SentSession | null = null;
  private refreshSeq = 0;
  /** The Done map last pushed to the Guest — resends only on a real change. */
  private lastPushedStates: { documentId: string; states: ActionItemStates | undefined } | null =
    null;
  /**
   * Serializes Done writes per Document (issue #144): a whole-map write
   * computed from a stale read would clobber a mark that landed meanwhile,
   * so each write chains onto the previous one for the same Document.
   */
  private readonly doneWriteChains = new Map<string, Promise<void>>();

  constructor() {
    const events = inject(HostBusEvents);
    events.attach(this);
    inject(DestroyRef).onDestroy(() => events.detach(this));
    // Job orchestration: upload-ready transitions and the load re-queue rule.
    effect(() => this.sweep(this.store.documents()));
    // Session flow: INIT_SESSION follows the open Document and its job state.
    effect(() => {
      const docId = this.open.docId();
      const doc =
        docId === null
          ? null
          : (this.store.documents()?.find((d) => d.id === docId) ?? null);
      void this.refreshSession(doc, this.store.extractionJobs().get(docId ?? ''), this.auth.user());
    });
    // Done-mark push (issue #144, ADR 0013): while a Document is open, every
    // change to its `actionItemStates` — a Host-side mark or un-mark, a
    // prune on Extraction save — goes out as ACTION_ITEM_STATES. A fresh
    // Session already carries the map, so only same-Document changes push.
    effect(() => {
      const docId = this.open.docId();
      const states = docId === null ? undefined : this.docById(docId)?.actionItemStates;
      const changed =
        docId !== null &&
        this.lastPushedStates?.documentId === docId &&
        !sameActionItemStates(this.lastPushedStates.states, states);
      this.lastPushedStates = docId === null ? null : { documentId: docId, states };
      if (changed) this.bus.pushActionItemStates(states ?? {});
    });
  }

  // -- HostBusProbe --------------------------------------------------------

  onGuestReady(): void {
    // The adapter already resent the Session and re-issued the in-flight job.
  }

  sessionFailed(_sessionId: string, error: ExtractionError): void {
    this.toasts.show({ tone: 'error', title: error.message });
  }

  jobStarted(_jobId: string, document: JobDocument): void {
    this.setJobState(document.documentId, 'running');
  }

  jobSucceeded(_jobId: string, extraction: ExtractionCandidate): void {
    const documentId = extraction.documentId;
    const doc = this.docById(documentId);
    if (doc && this.open.docId() === documentId) {
      // The adapter has just resent the open Document's Session with this
      // result. Mirror that resend so the Session flow dedupes against what
      // the panel shows, and drop any refresh still in flight from before it
      // (e.g. `running`) — a late stale Session would stick on the panel.
      this.refreshSeq++;
      const shown = normalizeExtractionRecord({ ...extraction, createdAt: nowTimestamp() });
      this.store.setExtraction(documentId, shown);
      this.lastSent = {
        documentId,
        documentTitle: doc.title,
        extractionState: 'none',
        extraction: shown,
      };
    }
    // The outcome is in: the job is no longer running, even while persisting.
    this.clearJobState(documentId);
    void this.persist(extraction);
  }

  jobFailed(_jobId: string, _error: ExtractionError): void {
    // `jobFailedFor` carries the Document — the app-level handler lives there.
  }

  jobFailedFor(_jobId: string, document: JobDocument, error: ExtractionError): void {
    this.setJobState(document.documentId, 'failed');
    void this.recordFailure(document.documentId, error);
    if (this.open.docId() !== document.documentId) {
      const title = this.docById(document.documentId)?.title ?? document.documentTitle;
      this.toasts.show({
        tone: 'error',
        title: `Couldn't analyze ${title}`,
        action: {
          label: 'Try again',
          run: () => this.retryRequested(document.documentId),
        },
      });
    }
  }

  /**
   * The app owns every re-enqueue (issue #31): clears the failure record and
   * re-supplies bytes — the only path for a Document this session's adapter
   * never saw. Unknown/deleted Documents are swallowed, never re-queued.
   */
  retryRequested(documentId: string): boolean {
    const doc = this.docById(documentId);
    // A queued/running job needs no second enqueue — the retry is a no-op.
    const inFlight = ['queued', 'running'].includes(
      this.store.extractionJobs().get(documentId) ?? '',
    );
    if (doc && doc.status === 'ready' && !inFlight) void this.retry(doc);
    return true;
  }

  /**
   * GUEST_SHOW_PAGE (issue #78): the adapter has already vetted the Session
   * and the wire shape; PageFocus owns the range check against the open
   * Document and drives the viewer — the sheet rests at half on a landing.
   */
  pageRequested(request: GuestShowPagePayload): void {
    this.pageFocus.show(request);
  }

  /**
   * GUEST_EXPAND_PANEL (issue #79): the adapter has already vetted the
   * Session; SheetExpand publishes the request so the Guest frame can lift
   * a peeking sheet — it alone knows the detent.
   */
  panelExpandRequested(): void {
    this.sheetExpand.request();
  }

  /**
   * GUEST_CREATE_REMINDER (issue #122): the adapter has already vetted the
   * Session and the id's wire shape; Reminders resolves the Action Item
   * from the Extraction index and opens the dialog the overview rows use.
   */
  reminderRequested(request: ReminderRequest): void {
    this.reminders.open(request.documentId, request.actionItemId);
  }

  /**
   * GUEST_SET_ACTION_ITEM_DONE (issue #144): the adapter has already vetted
   * the Session and the wire shape; the write is validated against the
   * Extraction index like `Reminders` resolves items. The Guest already
   * marked optimistically — silence, no toast.
   */
  actionItemDoneRequested(request: ActionItemDoneRequest): void {
    this.enqueueDoneWrite(request.documentId, () =>
      this.persistActionItemDone(request.documentId, request.actionItemId, request.done),
    );
  }

  /**
   * The attention overview's Mark done / un-mark (issue #144): the same
   * write path the Bus request takes, plus the Host-facing Undo toast a
   * successful mark shows.
   */
  async setActionItemDone(
    documentId: string,
    actionItemId: string,
    done: boolean,
  ): Promise<void> {
    const succeeded = await this.enqueueDoneWrite(documentId, () =>
      this.persistActionItemDone(documentId, actionItemId, done),
    );
    if (succeeded && done) {
      this.toasts.show({
        tone: 'success',
        title: 'Marked done',
        action: {
          label: 'Undo',
          run: () => void this.setActionItemDone(documentId, actionItemId, false),
        },
      });
    }
  }

  /**
   * Chains a Done write onto the Document's pending writes (issue #144) so
   * concurrent toggles can't clobber each other's marks.
   */
  private enqueueDoneWrite(documentId: string, write: () => Promise<boolean>): Promise<boolean> {
    const chain = (this.doneWriteChains.get(documentId) ?? Promise.resolve()).then(write);
    this.doneWriteChains.set(
      documentId,
      chain.then(
        () => undefined,
        () => undefined,
      ),
    );
    return chain;
  }

  /**
   * Writes one Done mark (issue #144, ADR 0013): resolves the item from the
   * Extraction index — a request for an id the Document no longer has is
   * refused and answered with the authoritative map, rolling back the
   * Guest's optimistic state. The Host computes `doneThrough` for a
   * computable recurrence via the contract's `doneMark` and answers every
   * write — including a failed one — with the authoritative map. Returns
   * whether the write landed.
   */
  private async persistActionItemDone(
    documentId: string,
    actionItemId: string,
    done: boolean,
  ): Promise<boolean> {
    const doc = this.docById(documentId);
    const item = this.store
      .extractionsByDocId()
      .get(documentId)
      ?.actionItems.find((i) => i.id === actionItemId);
    const current = doc?.actionItemStates ?? {};
    if (!doc || doc.status !== 'ready' || !item) {
      // Refused — still push the authoritative map so an optimistic Guest
      // rolls its mark back.
      if (doc && this.open.docId() === documentId) this.bus.pushActionItemStates(current);
      return false;
    }
    const next: ActionItemStates = { ...current };
    if (done) next[actionItemId] = doneMark(item, new Date());
    else delete next[actionItemId];
    try {
      await this.documents.setActionItemStates(documentId, next);
      if (this.open.docId() === documentId) this.bus.pushActionItemStates(next);
      return true;
    } catch (err) {
      console.warn('[done] could not write Action Item state for', documentId, err);
      this.toasts.show({ tone: 'error', title: "Couldn't update the item", body: 'Try again.' });
      // On failure the stored map stands — push it so the Guest rolls back.
      if (this.open.docId() === documentId) this.bus.pushActionItemStates(current);
      return false;
    }
  }

  // -- Job queue feeders ----------------------------------------------------

  private sweep(documents: DocumentRecord[] | null): void {
    if (documents === null) return;
    const reads: Promise<void>[] = [];
    for (const doc of documents) {
      if (doc.status !== 'ready' || this.handled.has(doc.id)) continue;
      this.handled.add(doc.id);
      reads.push(this.classify(doc));
    }
    if (this.swept) return;
    this.swept = true;
    void Promise.all(reads).then(() => this.store.markExtractionsLoaded());
  }

  /**
   * One ready Document per load: reads its stored Extraction into the Host's
   * index (ADR 0011) and auto-enqueues when it has none — a
   * recorded failure is never auto-requeued, `running` is never persisted.
   */
  private async classify(doc: DocumentRecord): Promise<void> {
    try {
      const record = await this.extractions.get(doc.id);
      if (record) {
        // Deleted while the read was in flight — never resurrect its entry.
        if (this.docById(doc.id)) this.store.setExtraction(doc.id, record);
        return;
      }
      if (doc.extractionFailure) return;
      if (this.store.extractionJobs().has(doc.id)) return;
      void this.enqueue(doc.id);
    } catch (err) {
      // Release the slot: a transient read failure must not cost the
      // Document its auto-enqueue for the rest of the session.
      this.handled.delete(doc.id);
      console.warn('[extraction] could not check job for', doc.id, err);
    }
  }

  private async retry(doc: DocumentRecord): Promise<void> {
    this.setJobState(doc.id, 'queued');
    try {
      const bytes = await this.documents.getBytes(doc.id);
      // Clearing lands only once fresh bytes are in hand — a Storage failure
      // leaves the recorded failure visible.
      await this.documents.setExtractionFailure(doc.id, null);
      this.bus.requestExtraction(toJobDocument(doc), bytes);
    } catch (err) {
      this.clearJobState(doc.id);
      console.warn('[extraction] retry could not enqueue', doc.id, err);
      this.toasts.show({
        tone: 'error',
        title: `Couldn't analyze ${doc.title}`,
        action: { label: 'Try again', run: () => this.retryRequested(doc.id) },
      });
    }
  }

  private async enqueue(documentId: string): Promise<void> {
    const doc = this.docById(documentId);
    if (!doc || doc.status !== 'ready') return;
    this.setJobState(documentId, 'queued');
    try {
      const bytes = await this.documents.getBytes(documentId);
      this.bus.requestExtraction(toJobDocument(doc), bytes);
    } catch (err) {
      this.clearJobState(documentId);
      console.warn('[extraction] could not enqueue job for', documentId, err);
      this.toasts.show({
        tone: 'error',
        title: `Couldn't analyze ${doc.title}`,
        action: { label: 'Try again', run: () => this.retryRequested(documentId) },
      });
    }
  }

  // -- Outcomes --------------------------------------------------------------

  /** Persist at `extractions/current` — atomic replace of the prior Extraction (ADR 0008). */
  private async persist(candidate: ExtractionCandidate): Promise<void> {
    const documentId = candidate.documentId;
    try {
      await this.extractions.save(documentId, candidate);
      const record =
        (await this.extractions.get(documentId)) ??
        normalizeExtractionRecord({ ...candidate, createdAt: nowTimestamp() });
      if (this.docById(documentId)) this.store.setExtraction(documentId, record);
      this.store.clearExtractionJob(documentId);
      await this.pruneActionItemStates(documentId, record);
      const doc = this.docById(documentId);
      if (doc && this.open.docId() === documentId) {
        // The adapter already resent INIT_SESSION with the result — mark that
        // resend so the Session refresh dedupes rather than double-sending.
        this.lastSent = {
          documentId,
          documentTitle: doc.title,
          extractionState: 'none',
          extraction: record,
        };
      } else {
        this.toasts.show({
          tone: 'success',
          title: `"${doc?.title ?? documentId}" is ready`,
          action: {
            label: 'View',
            run: () => {
              // Resolved at click time — the Document may have been deleted.
              const current = this.docById(documentId);
              if (current) this.open.open({ id: current.id, folderId: current.folderId });
            },
          },
        });
      }
    } catch (err) {
      // A failed Firestore write is a Host-side error, not a Bus concern (#7):
      // nothing is recorded, so the next load re-queues the Document.
      this.clearJobState(documentId);
      console.warn('[extraction] could not persist Extraction for', documentId, err);
      this.toasts.show({ tone: 'error', title: "Couldn't save the Extraction", body: 'Try again.' });
    }
  }

  private async recordFailure(documentId: string, error: ExtractionError): Promise<void> {
    try {
      await this.documents.setExtractionFailure(documentId, {
        code: error.code,
        message: error.message,
        retryable: error.retryable,
      });
    } catch (err) {
      console.warn('[extraction] could not record job failure for', documentId, err);
    }
  }

  // -- Session flow -----------------------------------------------------------

  private async refreshSession(
    doc: DocumentRecord | null,
    jobState: ExtractionJobState | undefined,
    user: SessionUser | null | undefined,
  ): Promise<void> {
    const seq = ++this.refreshSeq;
    if (doc === null || doc.status !== 'ready' || !user) return;
    const extraction = await this.extractionFor(doc.id);
    if (seq !== this.refreshSeq) return;
    const extractionState = jobState ?? (doc.extractionFailure ? 'failed' : 'none');
    if (
      this.lastSent?.documentId === doc.id &&
      this.lastSent.documentTitle === doc.title &&
      this.lastSent.extractionState === extractionState &&
      this.lastSent.extraction === extraction
    ) {
      return;
    }
    const authToken = await this.auth.idToken();
    if (seq !== this.refreshSeq) return;
    const session: Session = {
      sessionId: `sess-${crypto.randomUUID()}`,
      documentId: doc.id,
      documentTitle: doc.title,
      user,
      authToken,
      extraction,
      extractionState,
      actionItemStates: doc.actionItemStates,
    };
    this.bus.openSession(session);
    this.lastSent = {
      documentId: doc.id,
      documentTitle: doc.title,
      extractionState,
      extraction,
    };
  }

  private async extractionFor(documentId: string): Promise<ExtractionRecord | null> {
    const indexed = untracked(() => this.store.extractionsByDocId().get(documentId));
    if (indexed) return indexed;
    const record = await this.extractions.get(documentId);
    if (record && this.docById(documentId)) this.store.setExtraction(documentId, record);
    return record;
  }

  // -- helpers ----------------------------------------------------------------

  private setJobState(documentId: string, state: ExtractionJobState): void {
    this.store.setExtractionJob(documentId, state);
  }

  private clearJobState(documentId: string): void {
    this.store.clearExtractionJob(documentId);
  }

  /**
   * Orphaned Done keys — ids the new Extraction no longer carries — are
   * pruned when an Extraction is saved (ADR 0013). Resurfacing a changed
   * item not-Done is cheap; hiding a genuinely new one is not.
   */
  private async pruneActionItemStates(
    documentId: string,
    record: ExtractionRecord,
  ): Promise<void> {
    const states = this.docById(documentId)?.actionItemStates;
    if (!states) return;
    const keep = new Set(record.actionItems.map((i) => i.id));
    if (Object.keys(states).every((id) => keep.has(id))) return;
    const pruned = Object.fromEntries(
      Object.entries(states).filter(([id]) => keep.has(id)),
    );
    try {
      await this.documents.setActionItemStates(documentId, pruned);
    } catch (err) {
      console.warn('[done] could not prune Action Item states for', documentId, err);
    }
  }

  private docById(documentId: string): DocumentRecord | undefined {
    return this.store.documents()?.find((d) => d.id === documentId);
  }
}

/** Entry-wise equality — snapshots rebuild records, so reference isn't enough. */
function sameActionItemStates(
  a: ActionItemStates | undefined,
  b: ActionItemStates | undefined,
): boolean {
  const left = a ?? {};
  const right = b ?? {};
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const id of keys) {
    const la = left[id];
    const lb = right[id];
    if (!la !== !lb || (la && lb && (la.doneAt !== lb.doneAt || la.doneThrough !== lb.doneThrough))) {
      return false;
    }
  }
  return true;
}

function nowTimestamp(): ExtractionRecord['createdAt'] {
  return { seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 };
}

function toJobDocument(doc: DocumentRecord): JobDocument {
  return { documentId: doc.id, documentTitle: doc.title, contentType: doc.contentType };
}
