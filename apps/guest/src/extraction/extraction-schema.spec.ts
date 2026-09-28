import { describe, expect, it } from 'vitest';
import { validateExtractionContent } from './extraction-schema';
import type { ExtractionContent } from '@klartext/bus-contract';

/**
 * The #8 contract rules the Guest enforces on Gemini's output: required
 * conditionals, bounds, and formats beyond what TypeScript expresses.
 */

const VALID: ExtractionContent = {
  documentType: 'TENANCY_AGREEMENT',
  sourceLanguage: 'de',
  plainEnglishSummary: 'A rental agreement for a flat in Berlin.',
  extractionStatus: 'COMPLETE',
  keyTakeaways: [
    {
      text: "Three months' written notice is required to end the tenancy.",
      importance: 'CRITICAL',
      sourceQuote: 'Die Kündigungsfrist beträgt drei Monate.',
      page: 3,
    },
  ],
};

function valid(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...VALID, ...overrides };
}

describe('validateExtractionContent', () => {
  it('accepts a well-formed COMPLETE extraction', () => {
    const result = validateExtractionContent(VALID);
    expect(result).toEqual({ ok: true, content: VALID });
  });

  it('rejects non-objects and missing required fields', () => {
    for (const input of [null, 'x', 42, {}, { ...VALID, keyTakeaways: undefined }]) {
      expect(validateExtractionContent(input).ok).toBe(false);
    }
  });

  it('rejects a documentType outside the enum', () => {
    const result = validateExtractionContent(valid({ documentType: 'LEASE' }));
    expect(result.ok).toBe(false);
  });

  it('requires documentTypeLabel exactly for OTHER — and tolerates it elsewhere', () => {
    expect(
      validateExtractionContent(
        valid({ documentType: 'OTHER', documentTypeLabel: 'Service charge statement' }),
      ).ok,
    ).toBe(true);
    // The seeded fixtures carry human-readable labels on classified types.
    expect(
      validateExtractionContent(valid({ documentTypeLabel: 'Tenancy agreement' })).ok,
    ).toBe(true);
    const missing = validateExtractionContent(valid({ documentType: 'OTHER' }));
    expect(missing.ok).toBe(false);
  });

  it('requires statusExplanation for non-COMPLETE and omits it for COMPLETE', () => {
    for (const status of ['INSUFFICIENT_CONTENT', 'UNSUPPORTED_DOCUMENT'] as const) {
      expect(
        validateExtractionContent(
          valid({ extractionStatus: status, statusExplanation: 'Blank scans only.' }),
        ).ok,
      ).toBe(true);
      expect(validateExtractionContent(valid({ extractionStatus: status })).ok).toBe(false);
    }
    expect(
      validateExtractionContent(valid({ statusExplanation: 'All good.' })).ok,
    ).toBe(false);
  });

  it('requires sourceLanguage to be a BCP 47 tag', () => {
    for (const tag of ['de', 'de-AT', 'en', 'zh-Hant']) {
      expect(validateExtractionContent(valid({ sourceLanguage: tag })).ok).toBe(true);
    }
    for (const tag of ['', 'not a language', 'de-AT-DE-AT-DE-AT-DE-AT-x', '12345']) {
      expect(validateExtractionContent(valid({ sourceLanguage: tag })).ok).toBe(false);
    }
  });

  it('caps plainEnglishSummary at 200 words', () => {
    const words = (n: number) => Array.from({ length: n }, () => 'word').join(' ');
    expect(validateExtractionContent(valid({ plainEnglishSummary: words(200) })).ok).toBe(true);
    expect(validateExtractionContent(valid({ plainEnglishSummary: words(201) })).ok).toBe(false);
  });

  it('bounds keyTakeaways to 0–12 items', () => {
    const takeaway = { ...VALID.keyTakeaways[0]!, importance: 'NORMAL' };
    expect(validateExtractionContent(valid({ keyTakeaways: [] })).ok).toBe(true);
    expect(
      validateExtractionContent(valid({ keyTakeaways: Array(12).fill(takeaway) })).ok,
    ).toBe(true);
    expect(
      validateExtractionContent(valid({ keyTakeaways: Array(13).fill(takeaway) })).ok,
    ).toBe(false);
  });

  it('allows at most five CRITICAL takeaways', () => {
    const critical = { ...VALID.keyTakeaways[0]!, importance: 'CRITICAL' };
    const normal = { ...VALID.keyTakeaways[0]!, importance: 'NORMAL' };
    expect(
      validateExtractionContent(
        valid({ keyTakeaways: [...Array(5).fill(critical), normal] }),
      ).ok,
    ).toBe(true);
    expect(
      validateExtractionContent(valid({ keyTakeaways: Array(6).fill(critical) })).ok,
    ).toBe(false);
  });

  it('bounds sourceQuote to non-empty, ≤500 characters', () => {
    const t = VALID.keyTakeaways[0]!;
    for (const sourceQuote of ['', 'x'.repeat(501)]) {
      expect(
        validateExtractionContent(valid({ keyTakeaways: [{ ...t, sourceQuote }] })).ok,
      ).toBe(false);
    }
    expect(
      validateExtractionContent(
        valid({ keyTakeaways: [{ ...t, sourceQuote: 'x'.repeat(500) }] }),
      ).ok,
    ).toBe(true);
  });

  it('requires page, when present, to be a one-based positive integer', () => {
    const t = VALID.keyTakeaways[0]!;
    for (const page of [0, -1, 1.5, 'two']) {
      expect(
        validateExtractionContent(valid({ keyTakeaways: [{ ...t, page }] })).ok,
      ).toBe(false);
    }
    const withoutPage = { text: t.text, importance: t.importance, sourceQuote: t.sourceQuote };
    expect(validateExtractionContent(valid({ keyTakeaways: [withoutPage] })).ok).toBe(true);
  });

  it('maps the schema-subset `null` on nullable fields to absent', () => {
    const takeawayNoPage = {
      text: VALID.keyTakeaways[0]!.text,
      importance: VALID.keyTakeaways[0]!.importance,
      sourceQuote: VALID.keyTakeaways[0]!.sourceQuote,
    };
    const result = validateExtractionContent(
      valid({
        documentTypeLabel: null,
        statusExplanation: null,
        keyTakeaways: [{ ...takeawayNoPage, page: null }],
      }),
    );
    expect(result).toEqual({
      ok: true,
      content: { ...VALID, keyTakeaways: [takeawayNoPage] },
    });
  });

  it('reports readable issues on failure', () => {
    const result = validateExtractionContent(valid({ extractionStatus: 'INSUFFICIENT_CONTENT' }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.issues.every((i) => typeof i === 'string')).toBe(true);
    }
  });
});
