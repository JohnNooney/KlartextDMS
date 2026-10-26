import { describe, expect, it } from 'vitest';
import { extractionResponseSchema, validateExtractionContent } from './extraction-schema';
import type { ExtractionContent } from '@klartext/bus-contract';
import modelOutputs from './fixtures/model-outputs.json';

/**
 * The #8 contract rules the Guest enforces on Gemini's output: required
 * conditionals, bounds, and formats beyond what TypeScript expresses.
 */

const VALID: ExtractionContent = {
  documentType: 'TENANCY_AGREEMENT',
  sourceLanguage: 'de',
  plainEnglishSummary: 'A rental agreement for a flat in Berlin.',
  extractionStatus: 'COMPLETE',
  actionItems: [
    {
      text: "Three months' written notice is required to end the tenancy.",
      sourceQuote: 'Die Kündigungsfrist beträgt drei Monate.',
      page: 3,
      timing: { kind: 'NOTICE_PERIOD', duration: 3, unit: 'MONTHS', anchor: 'moving out' },
    },
  ],
  keyTakeaways: [
    {
      text: 'Service charges are settled once a year.',
      sourceQuote: 'Über die Vorauszahlungen wird jährlich abgerechnet.',
      page: 2,
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
    for (const input of [null, 'x', 42, {}, { ...VALID, keyTakeaways: undefined }, { ...VALID, actionItems: undefined }]) {
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
          valid({
            extractionStatus: status,
            statusExplanation: 'Blank scans only.',
            actionItems: [],
            keyTakeaways: [],
          }),
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

  it('bounds keyTakeaways to 0–10 items', () => {
    const takeaway = VALID.keyTakeaways[0]!;
    expect(validateExtractionContent(valid({ keyTakeaways: [] })).ok).toBe(true);
    expect(validateExtractionContent(valid({ keyTakeaways: Array(10).fill(takeaway) })).ok).toBe(
      true,
    );
    expect(validateExtractionContent(valid({ keyTakeaways: Array(11).fill(takeaway) })).ok).toBe(
      false,
    );
  });

  it('bounds actionItems to 0–6 items', () => {
    const item = VALID.actionItems[0]!;
    expect(validateExtractionContent(valid({ actionItems: Array(6).fill(item) })).ok).toBe(true);
    expect(validateExtractionContent(valid({ actionItems: Array(7).fill(item) })).ok).toBe(false);
  });

  it('requires both lists to be empty for non-COMPLETE statuses', () => {
    const base = { extractionStatus: 'INSUFFICIENT_CONTENT', statusExplanation: 'Blank page.' };
    expect(
      validateExtractionContent(valid({ ...base, actionItems: [], keyTakeaways: [] })).ok,
    ).toBe(true);
    expect(validateExtractionContent(valid({ ...base, keyTakeaways: [] })).ok).toBe(false);
    expect(validateExtractionContent(valid({ ...base, actionItems: [] })).ok).toBe(false);
  });

  it.each([
    ['Action Item', 'actionItems'],
    ['Key Takeaway', 'keyTakeaways'],
  ] as const)('bounds a %s sourceQuote to non-empty, ≤500 characters', (_label, key) => {
    const t = VALID[key][0]!;
    for (const sourceQuote of ['', 'x'.repeat(501)]) {
      expect(validateExtractionContent(valid({ [key]: [{ ...t, sourceQuote }] })).ok).toBe(false);
    }
    expect(
      validateExtractionContent(valid({ [key]: [{ ...t, sourceQuote: 'x'.repeat(500) }] })).ok,
    ).toBe(true);
  });

  it('requires page, when present, to be a one-based positive integer', () => {
    const t = VALID.keyTakeaways[0]!;
    for (const page of [0, -1, 1.5, 'two']) {
      expect(
        validateExtractionContent(valid({ keyTakeaways: [{ ...t, page }] })).ok,
      ).toBe(false);
    }
    const withoutPage = { text: t.text, sourceQuote: t.sourceQuote };
    expect(validateExtractionContent(valid({ keyTakeaways: [withoutPage] })).ok).toBe(true);
  });

  describe('Action Item timing', () => {
    const item = (timing: unknown) => valid({ actionItems: [{ ...VALID.actionItems[0]!, timing }] });
    const ok = (timing: unknown) => validateExtractionContent(item(timing)).ok;

    it('accepts a valid timing of every kind', () => {
      expect(ok({ kind: 'FIXED_DATE', dueDate: '2024-07-31' })).toBe(true);
      expect(ok({ kind: 'RECURRING', cadence: 'MONTHLY', scheduleLabel: 'Monthly on the 3rd' })).toBe(true);
      expect(ok({ kind: 'RECURRING', cadence: 'YEARLY', dayOfMonth: 31, scheduleLabel: 'Yearly' })).toBe(true);
      expect(ok({ kind: 'NOTICE_PERIOD', duration: 2, unit: 'WEEKS', anchor: 'renewal' })).toBe(true);
      expect(ok({ kind: 'NONE' })).toBe(true);
    });

    it('rejects an unknown kind or a missing timing', () => {
      expect(ok({ kind: 'SOON' })).toBe(false);
      expect(validateExtractionContent(valid({ actionItems: [{ text: 'x', sourceQuote: 'q' }] })).ok).toBe(false);
    });

    it('requires FIXED_DATE to carry a real ISO calendar date', () => {
      for (const dueDate of [undefined, '31.07.2024', '2024-7-31', '2024-02-30', '2023-02-29', '2024-13-01']) {
        expect(ok({ kind: 'FIXED_DATE', dueDate })).toBe(false);
      }
      expect(ok({ kind: 'FIXED_DATE', dueDate: '2024-02-29' })).toBe(true);
    });

    it('validates RECURRING fields', () => {
      const base = { kind: 'RECURRING', cadence: 'WEEKLY', scheduleLabel: 'Weekly' };
      expect(ok({ ...base, cadence: undefined })).toBe(false);
      expect(ok({ ...base, cadence: 'DAILY' })).toBe(false);
      expect(ok({ ...base, scheduleLabel: '' })).toBe(false);
      expect(ok({ ...base, scheduleLabel: 'x'.repeat(61) })).toBe(false);
      expect(ok({ ...base, scheduleLabel: 'x'.repeat(60) })).toBe(true);
      for (const dayOfMonth of [0, 32, 1.5]) expect(ok({ ...base, dayOfMonth })).toBe(false);
    });

    it('validates NOTICE_PERIOD fields', () => {
      const base = { kind: 'NOTICE_PERIOD', duration: 3, unit: 'MONTHS', anchor: 'moving out' };
      for (const duration of [0, 1.5, undefined]) expect(ok({ ...base, duration })).toBe(false);
      expect(ok({ ...base, unit: 'DECADES' })).toBe(false);
      expect(ok({ ...base, anchor: '' })).toBe(false);
      expect(ok({ ...base, anchor: 'x'.repeat(81) })).toBe(false);
      expect(ok({ ...base, anchor: 'x'.repeat(80) })).toBe(true);
    });

    it('rejects fields that belong to another kind', () => {
      expect(ok({ kind: 'NONE', dueDate: '2024-07-31' })).toBe(false);
      expect(ok({ kind: 'FIXED_DATE', dueDate: '2024-07-31', cadence: 'WEEKLY' })).toBe(false);
      expect(ok({ kind: 'RECURRING', cadence: 'WEEKLY', scheduleLabel: 'w', duration: 1 })).toBe(false);
      expect(ok({ kind: 'NOTICE_PERIOD', duration: 1, unit: 'DAYS', anchor: 'a', dayOfMonth: 3 })).toBe(false);
    });

    it('maps model-emitted nulls on the other kinds\' fields to absent', () => {
      const flat = {
        kind: 'FIXED_DATE',
        dueDate: '2024-07-31',
        cadence: null,
        dayOfMonth: null,
        scheduleLabel: null,
        duration: null,
        unit: null,
        anchor: null,
      };
      const result = validateExtractionContent(item(flat));
      expect(result.ok && result.content.actionItems[0]!.timing).toEqual({
        kind: 'FIXED_DATE',
        dueDate: '2024-07-31',
      });
    });
  });

  it('maps the schema-subset `null` on nullable fields to absent', () => {
    const takeawayNoPage = {
      text: VALID.keyTakeaways[0]!.text,
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

  /**
   * Production captures (2026-10-25): the flat wire schema let the model omit
   * the contract-required `anchor`/`scheduleLabel` — the validator is the last
   * line of defence and must keep refusing such output.
   */
  it('rejects captured model outputs that omit contract-required timing fields', () => {
    for (const output of modelOutputs.failing) {
      const result = validateExtractionContent(output);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.issues.some((i) => i.includes('is required for timing kind'))).toBe(true);
      }
    }
  });

  it('accepts the captured output whose timings need no conditional fields', () => {
    for (const output of modelOutputs.passing) {
      expect(validateExtractionContent(output).ok).toBe(true);
    }
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

/**
 * Wire↔contract parity (the October 2026 re-analysis failures): every
 * contract-required timing field must be required at generation time —
 * the schema is the enforcement, the validator the audit.
 */
describe('extractionResponseSchema timing variants', () => {
  type TimingVariant = {
    required?: string[];
    properties?: Record<string, { enum?: string[]; nullable?: boolean }>;
  };
  const timing = (
    extractionResponseSchema.properties!.actionItems.items as {
      properties: { timing: { anyOf: TimingVariant[] } };
    }
  ).properties.timing;

  const variantFor = (kind: string) =>
    timing.anyOf.find((v) => v.properties?.kind?.enum?.[0] === kind)!;

  it('declares exactly one variant per kind, each pinning kind to a single value', () => {
    expect(timing.anyOf).toHaveLength(4);
    expect(timing.anyOf.map((v) => v.properties?.kind?.enum)).toEqual(
      expect.arrayContaining([['FIXED_DATE'], ['RECURRING'], ['NOTICE_PERIOD'], ['NONE']]),
    );
  });

  it.each([
    ['FIXED_DATE', ['kind', 'dueDate']],
    ['RECURRING', ['kind', 'cadence', 'scheduleLabel']],
    ['NOTICE_PERIOD', ['kind', 'duration', 'unit', 'anchor']],
    ['NONE', ['kind']],
  ] as const)('requires exactly the contract fields for %s', (kind, required) => {
    expect([...variantFor(kind).required!].sort()).toEqual([...required].sort());
  });

  it.each([
    ['FIXED_DATE', ['kind', 'dueDate']],
    ['RECURRING', ['kind', 'cadence', 'dayOfMonth', 'scheduleLabel']],
    ['NOTICE_PERIOD', ['kind', 'duration', 'unit', 'anchor']],
    ['NONE', ['kind']],
  ] as const)('declares exactly the contract fields for %s', (kind, props) => {
    expect(Object.keys(variantFor(kind).properties!).sort()).toEqual([...props].sort());
  });

  it('leaves dayOfMonth optional on RECURRING', () => {
    expect(variantFor('RECURRING').required).not.toContain('dayOfMonth');
    expect(variantFor('RECURRING').properties!.dayOfMonth).toMatchObject({ nullable: true });
  });
});
