import { z } from 'zod';
import type { SchemaRequest } from 'firebase/ai';
import type { ExtractionContent } from '@klartext/bus-contract';

/**
 * The Extraction contract's runtime half (issue #8). `extractionResponseSchema`
 * is the structured-output schema handed to Firebase AI Logic — verbatim from
 * #8, lowered to the SDK's `SchemaRequest` shape (lowercase type names,
 * `required` arrays, `nullable` for the conditional fields the model may emit
 * as `null`). Gemini emits only `ExtractionContent`; generation metadata is
 * assembled by the provider.
 *
 * `validateExtractionContent` is the canonical Zod validator the spec assigns
 * to the Guest's extraction pipeline. It enforces the rules the wire schema
 * cannot: required-conditionals (`documentTypeLabel` iff `OTHER`,
 * `statusExplanation` iff non-`COMPLETE`), the 200-word summary cap, BCP 47
 * `sourceLanguage`, quote bounds, one-based `page`, and the five-CRITICAL cap.
 * Model-emitted `null`s normalize to absent — shape fixups, not semantic
 * coercion; nothing else is repaired silently.
 */
export const extractionResponseSchema: SchemaRequest = {
  type: 'object',
  properties: {
    documentType: {
      type: 'string',
      enum: [
        'TENANCY_AGREEMENT',
        'HEALTH_INSURANCE',
        'EMPLOYMENT_CONTRACT',
        'INTERNET_OR_PHONE',
        'GOVERNMENT_LETTER',
        'OTHER',
      ],
    },
    documentTypeLabel: { type: 'string', nullable: true },
    sourceLanguage: { type: 'string' },
    plainEnglishSummary: { type: 'string' },
    extractionStatus: {
      type: 'string',
      enum: ['COMPLETE', 'INSUFFICIENT_CONTENT', 'UNSUPPORTED_DOCUMENT'],
    },
    statusExplanation: { type: 'string', nullable: true },
    keyTakeaways: {
      type: 'array',
      minItems: 0,
      maxItems: 12,
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          importance: { type: 'string', enum: ['NORMAL', 'CRITICAL'] },
          sourceQuote: { type: 'string' },
          page: { type: 'integer', minimum: 1, nullable: true },
        },
        required: ['text', 'importance', 'sourceQuote'],
      },
    },
  },
  required: [
    'documentType',
    'sourceLanguage',
    'plainEnglishSummary',
    'extractionStatus',
    'keyTakeaways',
  ],
};

const wordCount = (s: string): number => s.split(/\s+/).filter(Boolean).length;

const isBcp47 = (tag: string): boolean => {
  try {
    return Intl.getCanonicalLocales(tag).length > 0;
  } catch {
    return false;
  }
};

const optionalString = z
  .string()
  .nullish()
  .transform((v) => v ?? undefined);

const keyTakeawaySchema = z.object({
  text: z.string().min(1),
  importance: z.enum(['NORMAL', 'CRITICAL']),
  sourceQuote: z.string().min(1).max(500),
  page: z
    .number()
    .int()
    .min(1)
    .nullish()
    .transform((v) => v ?? undefined),
});

export const extractionContentSchema = z
  .object({
    documentType: z.enum([
      'TENANCY_AGREEMENT',
      'HEALTH_INSURANCE',
      'EMPLOYMENT_CONTRACT',
      'INTERNET_OR_PHONE',
      'GOVERNMENT_LETTER',
      'OTHER',
    ]),
    documentTypeLabel: optionalString,
    sourceLanguage: z.string().refine(isBcp47, 'sourceLanguage must be a BCP 47 tag'),
    plainEnglishSummary: z
      .string()
      .refine((s) => wordCount(s) <= 200, 'plainEnglishSummary exceeds 200 words'),
    extractionStatus: z.enum(['COMPLETE', 'INSUFFICIENT_CONTENT', 'UNSUPPORTED_DOCUMENT']),
    statusExplanation: optionalString,
    keyTakeaways: z.array(keyTakeawaySchema).min(0).max(12),
  })
  .superRefine((content, ctx) => {
    if (content.documentType === 'OTHER' && content.documentTypeLabel === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['documentTypeLabel'],
        message: 'documentTypeLabel is required when documentType is OTHER',
      });
    }
    const complete = content.extractionStatus === 'COMPLETE';
    if (!complete && content.statusExplanation === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['statusExplanation'],
        message: 'statusExplanation is required for non-COMPLETE statuses',
      });
    }
    if (complete && content.statusExplanation !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['statusExplanation'],
        message: 'statusExplanation must be omitted for COMPLETE',
      });
    }
    const critical = content.keyTakeaways.filter((t) => t.importance === 'CRITICAL').length;
    if (critical > 5) {
      ctx.addIssue({
        code: 'custom',
        path: ['keyTakeaways'],
        message: 'at most five Key Takeaways may be CRITICAL',
      });
    }
  });

export type ValidationResult =
  | { ok: true; content: ExtractionContent }
  | { ok: false; issues: string[] };

export function validateExtractionContent(input: unknown): ValidationResult {
  const parsed = extractionContentSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    };
  }
  return { ok: true, content: parsed.data };
}
