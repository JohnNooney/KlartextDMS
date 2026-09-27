import type {
  ExtractionCandidate,
  ExtractionError,
  ExtractDocumentPayload,
} from '@klartext/bus-contract';

const NOT_WIRED: ExtractionError = {
  code: 'AI_UNAVAILABLE',
  message: 'The document assistant is not connected yet.',
  retryable: true,
};

/**
 * The Extraction Job runner — the seam the Gemini-via-AI-Logic client lands
 * on (issue #30). Until then a Job fails fast with a retryable
 * AI_UNAVAILABLE rather than hanging against the Host's 120 s watchdog.
 */
export function runExtractionJob(
  _job: ExtractDocumentPayload,
): Promise<ExtractionCandidate> {
  return Promise.reject(NOT_WIRED);
}
