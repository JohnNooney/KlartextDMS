import { describe, expect, it } from 'vitest';
import { isExtractionCandidate } from './extraction.js';
import { goldenFixtureMessages } from './fixtures.js';

const fixture = goldenFixtureMessages.AI_PROCESSING_SUCCESS.payload.extraction;

describe('isExtractionCandidate', () => {
  it('accepts the golden fixture Extraction', () => {
    expect(isExtractionCandidate(fixture)).toBe(true);
  });

  it('accepts a minimal COMPLETE candidate with no takeaways', () => {
    expect(
      isExtractionCandidate({
        documentId: 'doc-1',
        schemaVersion: 1,
        promptVersion: 'klartext-extraction-v1',
        model: 'gemini-test',
        documentType: 'OTHER',
        documentTypeLabel: 'Custom label',
        sourceLanguage: 'de',
        plainEnglishSummary: 'A document.',
        extractionStatus: 'COMPLETE',
        keyTakeaways: [],
      }),
    ).toBe(true);
  });

  it('accepts the non-COMPLETE statuses with their explanation', () => {
    for (const extractionStatus of ['INSUFFICIENT_CONTENT', 'UNSUPPORTED_DOCUMENT']) {
      expect(
        isExtractionCandidate({
          ...fixture,
          extractionStatus,
          statusExplanation: 'Nothing readable here.',
          keyTakeaways: [],
        }),
      ).toBe(true);
    }
  });

  it.each([
    ['a non-object', 'extraction'],
    ['null', null],
    ['a missing documentId', { ...fixture, documentId: undefined }],
    ['a foreign documentId type', { ...fixture, documentId: 42 }],
    ['a wrong schemaVersion', { ...fixture, schemaVersion: 2 }],
    ['a foreign promptVersion', { ...fixture, promptVersion: 'other-prompt' }],
    ['an unknown documentType', { ...fixture, documentType: 'MYSTERY' }],
    ['an unknown extractionStatus', { ...fixture, extractionStatus: 'PARTIAL' }],
    ['a missing summary', { ...fixture, plainEnglishSummary: undefined }],
    ['a takeaway with an unknown importance', {
      ...fixture,
      keyTakeaways: [{ text: 'x', importance: 'URGENT', sourceQuote: 'q' }],
    }],
    ['a takeaway without a sourceQuote', {
      ...fixture,
      keyTakeaways: [{ text: 'x', importance: 'NORMAL' }],
    }],
    ['a non-array keyTakeaways', { ...fixture, keyTakeaways: 'none' }],
  ])('rejects %s', (_label, value) => {
    expect(isExtractionCandidate(value)).toBe(false);
  });
});
