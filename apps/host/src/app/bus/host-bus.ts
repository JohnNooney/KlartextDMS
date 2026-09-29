import { Injectable } from '@angular/core';
import type { JobDocument, Session } from '@klartext/bus-contract';
import type { HostAdapter } from '@klartext/bus-contract/conformance';

/**
 * App-side handle on the live Host Bus adapter (issues #28, #31). The Guest
 * frame attaches the adapter once mounted; the rest of the app talks to it
 * through this service without owning Bus wiring — Sessions on open
 * (`openSession`), Extraction Jobs (`requestExtraction`), and job
 * cancellation on delete (`cancelJobsFor`, issue #16). Every call is a no-op
 * before the frame attaches: a deleted-before-ready Document has nothing to
 * cancel, and a Session requested pre-`GUEST_READY` is buffered by the
 * adapter anyway.
 */
@Injectable({ providedIn: 'root' })
export class HostBus {
  private adapter: HostAdapter | null = null;

  attach(adapter: HostAdapter): void {
    this.adapter = adapter;
  }

  detach(adapter: HostAdapter): void {
    if (this.adapter === adapter) this.adapter = null;
  }

  /** Hands the Guest a new Session for an open Document. */
  openSession(session: Session): void {
    this.adapter?.openSession(session);
  }

  /** Enqueues an Extraction Job for a Document whose bytes the Host holds. */
  requestExtraction(document: JobDocument, bytes: ArrayBuffer): void {
    this.adapter?.requestExtraction(document, bytes);
  }

  /** Drops queued jobs for `documentId` and discards a running job's result. */
  cancelJobsFor(documentId: string): void {
    this.adapter?.cancelJobs(documentId);
  }
}
