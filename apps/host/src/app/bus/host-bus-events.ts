import { Injectable } from '@angular/core';
import type { ExtractionCandidate, ExtractionError, JobDocument } from '@klartext/bus-contract';
import type { HostBusProbe } from './host-bus.adapter';

/**
 * App-side sink for Bus adapter outcomes (issues #25, #31). The Guest frame
 * hands this service to the adapter as its probe; the Session/job
 * orchestration in `ExtractionFlow` attaches as the delegate once the
 * signed-in data layer exists. Outcomes arriving with no delegate attached —
 * the brief window before the library mounts — are logged, never dropped
 * silently.
 */
@Injectable({ providedIn: 'root' })
export class HostBusEvents implements HostBusProbe {
  private delegate: HostBusProbe | null = null;

  /** Registers the orchestrator that owns Bus outcomes while signed in. */
  attach(delegate: HostBusProbe): void {
    this.delegate = delegate;
  }

  detach(delegate: HostBusProbe): void {
    if (this.delegate === delegate) this.delegate = null;
  }

  onGuestReady(): void {
    // The adapter has already resent the Session and re-issued in-flight jobs.
    this.delegate?.onGuestReady?.();
  }

  sessionFailed(sessionId: string, error: ExtractionError): void {
    if (this.delegate) {
      this.delegate.sessionFailed(sessionId, error);
    } else {
      console.warn('[bus] Session failed', sessionId, error);
    }
  }

  jobSucceeded(jobId: string, extraction: ExtractionCandidate): void {
    if (this.delegate) {
      this.delegate.jobSucceeded(jobId, extraction);
    } else {
      console.info('[bus] Extraction job succeeded', jobId, extraction.documentId);
    }
  }

  jobFailed(jobId: string, error: ExtractionError): void {
    if (!this.delegate) console.warn('[bus] Extraction job failed', jobId, error);
    this.delegate?.jobFailed(jobId, error);
  }

  jobStarted(jobId: string, document: JobDocument): void {
    this.delegate?.jobStarted?.(jobId, document);
  }

  jobFailedFor(jobId: string, document: JobDocument, error: ExtractionError): void {
    this.delegate?.jobFailedFor?.(jobId, document, error);
  }

  retryRequested(documentId: string): boolean {
    return this.delegate?.retryRequested?.(documentId) ?? false;
  }
}
