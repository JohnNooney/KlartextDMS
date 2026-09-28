import type { FirebaseApp } from 'firebase/app';
import { GoogleAIBackend, getAI, getGenerativeModel } from 'firebase/ai';
import type { ExtractDocumentPayload, ExtractionCandidate } from '@klartext/bus-contract';
import type { GuestConfig } from '../guest-config';
import type { ExtractionProvider } from './extraction-provider';
import { extractionResponseSchema } from './extraction-schema';
import { createFakeExtractionProvider } from './fake-provider';
import { createGeminiExtractionProvider } from './gemini-provider';

/** The model behind prompt v1; fixtures record it in their `model` field. */
export const EXTRACTION_MODEL = 'gemini-3.8-flash';

/**
 * Provider selection (issue #30): the deterministic fixture provider when the
 * build-time flag is set, otherwise Gemini via Firebase AI Logic on the
 * Gemini Developer API backend (`GoogleAIBackend` — free tier, revised from
 * the Vertex backend in ADR 0007).
 */
function createExtractionProvider(config: GuestConfig, app: FirebaseApp): ExtractionProvider {
  if (config.fakeAiProvider) return createFakeExtractionProvider();
  // The project enforces App Check replay protection on AI Logic
  // (firebaseml) — regular tokens are rejected, so every request needs a
  // limited-use token. Valid also when protection is off.
  const ai = getAI(app, {
    backend: new GoogleAIBackend(),
    useLimitedUseAppCheckTokens: true,
  });
  const model = getGenerativeModel(ai, {
    model: EXTRACTION_MODEL,
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: extractionResponseSchema,
    },
  });
  return createGeminiExtractionProvider(model, EXTRACTION_MODEL);
}

/**
 * The Extraction Job runner the Bus adapter calls per `EXTRACT_DOCUMENT`
 * (issue #30): provider in, Job out — the Guest never persists; the candidate
 * goes back over the Bus for the Host to timestamp and save (ADR 0008).
 */
export function createExtractionJobRunner(
  config: GuestConfig,
  app: FirebaseApp,
): (job: ExtractDocumentPayload) => Promise<ExtractionCandidate> {
  const provider = createExtractionProvider(config, app);
  return (job) => provider.extract(job.document, job.bytes);
}
