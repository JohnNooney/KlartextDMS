import type { ExtractionCandidate, JobDocument } from '@klartext/bus-contract';

/**
 * The Guest's AI provider seam (issue #30): one Job in, one validated
 * `ExtractionCandidate` out — or a rejection carrying a contract
 * `ExtractionError` for the Bus adapter to emit as `AI_PROCESSING_ERROR`.
 * Two implementations: Gemini via Firebase AI Logic (ADR 0007) and the
 * deterministic fake behind `VITE_FAKE_AI_PROVIDER` for e2e/dev.
 */
export interface ExtractionProvider {
  extract(document: JobDocument, bytes: ArrayBuffer): Promise<ExtractionCandidate>;
}
