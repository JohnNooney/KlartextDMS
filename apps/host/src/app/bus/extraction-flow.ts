import { DestroyRef, Injectable, effect, inject } from '@angular/core';
import type {
  ExtractionCandidate,
  ExtractionError,
  ExtractionRecord,
  ExtractionState,
  JobDocument,
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
  private readonly auth = inject(AuthService);
  private readonly bus = inject(HostBus);
  private readonly toasts = inject(ToastService);

  /** Extraction Records resolved this session — the Session builder's read-through cache. */
  private readonly extractionCache = new Map<string, ExtractionRecord>();
  /** Ready Documents the auto-enqueue rule already handled this load. */
  private readonly handled = new Set<string>();
  private lastSent: SentSession | null = null;
  private refreshSeq = 0;

  constructor() {
    const events = inject(HostBusEvents);
    events.attach(this);
    inject(DestroyRef).onDestroy(() => events.detach(this));
    // Job orchestration: upload-ready transitions and the load re-queue rule.
    effect(() => this.sweep(this.store.documents() ?? []));
    // Session flow: INIT_SESSION follows the open Document and its job state.
    effect(() => {
      const docId = this.open.docId();
      const doc =
        docId === null
          ? null
          : (this.store.documents()?.find((d) => d.id === docId) ?? null);
      void this.refreshSession(doc, this.store.extractionJobs().get(docId ?? ''), this.auth.user());
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

  // -- Job queue feeders ----------------------------------------------------

  private sweep(documents: DocumentRecord[]): void {
    for (const doc of documents) {
      if (doc.status !== 'ready' || this.handled.has(doc.id)) continue;
      this.handled.add(doc.id);
      void this.classify(doc);
    }
  }

  /**
   * One ready Document per load: resolves whether it holds a stored Extraction
   * (the chips' no-badge rule, #32) and auto-enqueues when it does not — a
   * recorded failure is never auto-requeued, `running` is never persisted.
   */
  private async classify(doc: DocumentRecord): Promise<void> {
    try {
      const record = await this.extractions.get(doc.id);
      if (record) {
        this.extractionCache.set(doc.id, record);
        this.store.markExtractionStored(doc.id);
        return;
      }
      if (doc.extractionFailure) return;
      if (this.store.extractionJobs().has(doc.id)) return;
      await this.enqueue(doc.id);
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
        ({ ...candidate, createdAt: { seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 } } as ExtractionRecord);
      this.extractionCache.set(documentId, record);
      this.store.markExtractionStored(documentId);
      this.store.clearExtractionJob(documentId);
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
    const cached = this.extractionCache.get(documentId);
    if (cached) return cached;
    const record = await this.extractions.get(documentId);
    if (record) this.extractionCache.set(documentId, record);
    return record;
  }

  // -- helpers ----------------------------------------------------------------

  private setJobState(documentId: string, state: ExtractionJobState): void {
    this.store.setExtractionJob(documentId, state);
  }

  private clearJobState(documentId: string): void {
    this.store.clearExtractionJob(documentId);
  }

  private docById(documentId: string): DocumentRecord | undefined {
    return this.store.documents()?.find((d) => d.id === documentId);
  }
}

function toJobDocument(doc: DocumentRecord): JobDocument {
  return { documentId: doc.id, documentTitle: doc.title, contentType: doc.contentType };
}
