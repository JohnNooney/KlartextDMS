import { describe, expect, it } from 'vitest';
import { isExtractionCandidate, normalizeExtractionRecord } from './extraction.js';
import {
  goldenFixtureMessages,
  legacyV1ExtractionFixtures,
  seededExtractionFixtures,
} from './fixtures.js';

const fixture = goldenFixtureMessages.AI_PROCESSING_SUCCESS.payload.extraction;

describe('isExtractionCandidate', () => {
  it('accepts the golden fixture Extraction', () => {
    expect(isExtractionCandidate(fixture)).toBe(true);
  });

  it('accepts a minimal COMPLETE candidate with no takeaways', () => {
    expect(
      isExtractionCandidate({
        documentId: 'doc-1',
        schemaVersion: 2,
        promptVersion: 'klartext-extraction-v2',
        model: 'gemini-test',
        documentType: 'OTHER',
        documentTypeLabel: 'Custom label',
        sourceLanguage: 'de',
        plainEnglishSummary: 'A document.',
        extractionStatus: 'COMPLETE',
        actionItems: [],
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
          actionItems: [],
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
    ['a wrong schemaVersion', { ...fixture, schemaVersion: 1 }],
    ['a foreign promptVersion', { ...fixture, promptVersion: 'other-prompt' }],
    ['an unknown documentType', { ...fixture, documentType: 'MYSTERY' }],
    ['an unknown extractionStatus', { ...fixture, extractionStatus: 'PARTIAL' }],
    ['a missing summary', { ...fixture, plainEnglishSummary: undefined }],
    ['a takeaway without a sourceQuote', {
      ...fixture,
      keyTakeaways: [{ text: 'x' }],
    }],
    ['an Action Item without timing', {
      ...fixture,
      actionItems: [{ text: 'x', sourceQuote: 'q' }],
    }],
    ['an Action Item with an unknown timing kind', {
      ...fixture,
      actionItems: [{ text: 'x', sourceQuote: 'q', timing: { kind: 'SOON' } }],
    }],
    ['missing actionItems', { ...fixture, actionItems: undefined }],
    ['a non-array actionItems', { ...fixture, actionItems: 'none' }],
    ['a non-array keyTakeaways', { ...fixture, keyTakeaways: 'none' }],
  ])('rejects %s', (_label, value) => {
    expect(isExtractionCandidate(value)).toBe(false);
  });
});

const CREATED_AT = { seconds: 1710500400, nanoseconds: 0 };

describe('normalizeExtractionRecord', () => {
  const v1 = { ...legacyV1ExtractionFixtures['doc-versicherungsschein']!, createdAt: CREATED_AT };

  it('turns v1 CRITICAL takeaways into Action Items with no timing', () => {
    const record = normalizeExtractionRecord(v1);
    expect(record.actionItems).toHaveLength(1);
    expect(record.actionItems[0]).toMatchObject({
      text: v1.keyTakeaways[0]!.text,
      sourceQuote: 'Sonderkündigungsrecht bis zum 31. Januar',
      page: 1,
      timing: { kind: 'NONE' },
    });
    expect(record.actionItems[0]).not.toHaveProperty('importance');
  });

  it('keeps v1 NORMAL takeaways as Key Takeaways without importance', () => {
    const record = normalizeExtractionRecord(v1);
    expect(record.keyTakeaways).toEqual([
      {
        text: 'Professional teeth cleaning is reimbursed up to €80 a year.',
        sourceQuote: 'Professionelle Zahnreinigung bis zu 80 € jährlich',
        page: 2,
      },
    ]);
  });

  it('keeps schemaVersion 1 and the rest of the record on a normalized v1', () => {
    const record = normalizeExtractionRecord(v1);
    expect(record).toMatchObject({
      documentId: 'doc-versicherungsschein',
      schemaVersion: 1,
      promptVersion: 'klartext-extraction-v1',
      createdAt: CREATED_AT,
      plainEnglishSummary: v1.plainEnglishSummary,
    });
  });

  it('passes a v2 record through, adding Action Item ids', () => {
    const v2 = { ...seededExtractionFixtures['doc-mietvertrag']!, createdAt: CREATED_AT };
    const record = normalizeExtractionRecord(v2);
    expect(record.schemaVersion).toBe(2);
    expect(record.keyTakeaways).toEqual(v2.keyTakeaways);
    expect(record.actionItems.map(({ id: _id, ...item }) => item)).toEqual(v2.actionItems);
  });

  it('gives every Action Item a distinct, stable id', () => {
    const v2 = { ...seededExtractionFixtures['doc-mietvertrag']!, createdAt: CREATED_AT };
    const ids = normalizeExtractionRecord(v2).actionItems.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(normalizeExtractionRecord(v2).actionItems.map((i) => i.id)).toEqual(ids);
  });

  it('keeps the id when re-analysis finds the same quote and timing kind', () => {
    const before = normalizeExtractionRecord(v1).actionItems[0]!;
    const reanalysed = {
      ...seededExtractionFixtures['doc-versicherungsschein']!,
      createdAt: CREATED_AT,
    };
    // v2 re-analysis: same quote, but dated — kind changes, so the id changes.
    expect(normalizeExtractionRecord(reanalysed).actionItems[0]!.id).not.toBe(before.id);
    const sameKind = {
      ...reanalysed,
      actionItems: [
        { ...reanalysed.actionItems[0]!, text: 'Reworded.', timing: { kind: 'NONE' as const } },
      ],
    };
    expect(normalizeExtractionRecord(sameKind).actionItems[0]!.id).toBe(before.id);
  });

  it('is idempotent on an already-normalized record', () => {
    const once = normalizeExtractionRecord(v1);
    expect(normalizeExtractionRecord(once)).toEqual(once);
  });
});

describe('seeded fixtures', () => {
  it('are all valid v2 candidates covering every timing kind', () => {
    const kinds = new Set<string>();
    for (const candidate of Object.values(seededExtractionFixtures)) {
      expect(isExtractionCandidate(candidate)).toBe(true);
      for (const item of candidate.actionItems) kinds.add(item.timing.kind);
    }
    expect([...kinds].sort()).toEqual(['FIXED_DATE', 'NONE', 'NOTICE_PERIOD', 'RECURRING']);
  });

  it('keep the legacy v1 fixture as schemaVersion 1', () => {
    expect(legacyV1ExtractionFixtures['doc-versicherungsschein']!.schemaVersion).toBe(1);
  });
});
