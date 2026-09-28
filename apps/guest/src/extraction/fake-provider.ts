import { goldenFixtureMessages } from '@klartext/bus-contract';
import type { ExtractionCandidate, ExtractionError } from '@klartext/bus-contract';
import extractionFixtures from '../../../../scripts/fixtures/extractions.json';
import { validateExtractionContent } from './extraction-schema';
import type { ExtractionProvider } from './extraction-provider';

/**
 * The fake provider behind `VITE_FAKE_AI_PROVIDER=true` (issue #30, ADR 0007):
 * the same seeded fixture Extractions `scripts/seed.mjs` writes into the
 * emulator — deterministic, offline, free — so e2e and dev never touch real
 * Gemini (there is no AI Logic emulator). Documents outside the seed set get
 * the golden Bus fixture's Extraction re-stamped with their documentId.
 */
const SEEDED = extractionFixtures as unknown as Record<string, ExtractionCandidate>;

const INVALID_FIXTURE: ExtractionError = {
  code: 'INVALID_EXTRACTION',
  message: 'The seeded Extraction fixture fails the contract validator.',
  retryable: false,
};

export function createFakeExtractionProvider(): ExtractionProvider {
  return {
    extract(document) {
      const fixture = SEEDED[document.documentId] ?? {
        ...goldenFixtureMessages.AI_PROCESSING_SUCCESS.payload.extraction,
        documentId: document.documentId,
      };
      // Same validator as the real provider — fixture drift fails fast.
      if (!validateExtractionContent(fixture).ok) return Promise.reject(INVALID_FIXTURE);
      return Promise.resolve(structuredClone(fixture));
    },
  };
}
