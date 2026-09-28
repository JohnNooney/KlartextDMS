import { Injectable } from '@angular/core';
import type { HostAdapter } from '@klartext/bus-contract/conformance';

/**
 * App-side handle on the Extraction Job queue inside the Bus adapter
 * (issue #28). The Guest frame attaches the live adapter once mounted; the
 * Document library cancels a Document's queued/running jobs on delete
 * (issue #16) without owning Bus wiring. No-op before the frame attaches —
 * deleting before the Guest announces ready has nothing to cancel.
 */
@Injectable({ providedIn: 'root' })
export class ExtractionJobs {
  private adapter: HostAdapter | null = null;

  attach(adapter: HostAdapter): void {
    this.adapter = adapter;
  }

  detach(adapter: HostAdapter): void {
    if (this.adapter === adapter) this.adapter = null;
  }

  /** Drops queued jobs for `documentId` and discards a running job's result. */
  cancelJobsFor(documentId: string): void {
    this.adapter?.cancelJobs(documentId);
  }
}
