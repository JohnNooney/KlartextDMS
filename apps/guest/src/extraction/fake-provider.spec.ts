import { describe, expect, it } from 'vitest';
import { goldenFixtureMessages, seededExtractionFixtures } from '@klartext/bus-contract';
import type { JobDocument } from '@klartext/bus-contract';
import { createFakeExtractionProvider } from './fake-provider';

/**
 * The deterministic fake (issue #30): returns the same seeded fixture
 * Extractions the emulator seeds (`seededExtractionFixtures` in the contract
 * package — the same file `scripts/seed.mjs` persists), offline and free, for
 * e2e and dev.
 */

const BYTES = new TextEncoder().encode('%PDF-1.4 whatever').buffer as ArrayBuffer;

function document(documentId: string): JobDocument {
  return { documentId, documentTitle: documentId, contentType: 'application/pdf' };
}

describe('fake extraction provider', () => {
  it('returns the seeded fixture for a seeded Document, byte-for-byte', async () => {
    const provider = createFakeExtractionProvider();
    for (const documentId of Object.keys(seededExtractionFixtures)) {
      const candidate = await provider.extract(document(documentId), BYTES);
      expect(candidate).toEqual(seededExtractionFixtures[documentId]);
    }
  });

  it('is deterministic across calls and hands out independent copies', async () => {
    const provider = createFakeExtractionProvider();
    const first = await provider.extract(document('doc-mietvertrag'), BYTES);
    first.keyTakeaways.length = 0; // mutate the returned candidate
    const second = await provider.extract(document('doc-mietvertrag'), BYTES);
    expect(second).toEqual(seededExtractionFixtures['doc-mietvertrag']);
    expect(second.keyTakeaways.length).toBeGreaterThan(0);
  });

  it('falls back to the golden fixture Extraction for unseeded Documents', async () => {
    const provider = createFakeExtractionProvider();
    const candidate = await provider.extract(document('doc-uploaded-later'), BYTES);
    expect(candidate).toEqual({
      ...goldenFixtureMessages.AI_PROCESSING_SUCCESS.payload.extraction,
      documentId: 'doc-uploaded-later',
    });
  });

  it('returns a valid ExtractionCandidate for every seeded fixture', async () => {
    // Guards drift between the seed file and the #8 validator.
    const provider = createFakeExtractionProvider();
    for (const documentId of Object.keys(seededExtractionFixtures)) {
      const candidate = await provider.extract(document(documentId), BYTES);
      expect(candidate.documentId).toBe(documentId);
      expect(candidate.promptVersion).toBe('klartext-extraction-v1');
    }
  });
});
