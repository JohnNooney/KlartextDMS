import { Injectable } from '@angular/core';
import type { ExtractionCandidate, ExtractionError } from '@klartext/bus-contract';
import type { HostBusProbe } from './host-bus.adapter';

/**
 * App-side sink for Bus adapter outcomes (issue #25). For now it logs and
 * stays in memory — the document stores that consume these events land with
 * the repositories and Session-flow issues (#27, #31).
 */
@Injectable({ providedIn: 'root' })
export class HostBusEvents implements HostBusProbe {
  onGuestReady(): void {
    // The adapter has already resent the Session and re-issued in-flight jobs.
    console.info('[bus] Guest announced ready');
  }

  sessionFailed(sessionId: string, error: ExtractionError): void {
    // TODO(#31): surface as a Session-level failure on the open Document.
    console.warn('[bus] Session failed', sessionId, error);
  }

  jobSucceeded(jobId: string, extraction: ExtractionCandidate): void {
    // TODO(#31): persist the Extraction and refresh the open Document's panel.
    console.info('[bus] Extraction job succeeded', jobId, extraction.documentId);
  }

  jobFailed(jobId: string, error: ExtractionError): void {
    // TODO(#31): surface as a job failure with retry affordance.
    console.warn('[bus] Extraction job failed', jobId, error);
  }
}
