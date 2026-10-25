import { z } from 'zod';
import type { SchemaRequest } from 'firebase/ai';
import type {
  DocumentType,
  ActionTiming,
  ExtractionContent,
  ExtractionStatus,
  RecurrenceCadence,
  NoticeUnit,
  ActionTimingKind,
} from '@klartext/bus-contract';

/**
 * The Extraction contract's runtime half (issue #8). `extractionResponseSchema`
 * is the structured-output schema handed to Firebase AI Logic — verbatim from
 * #8, lowered to the SDK's `SchemaRequest` shape (lowercase type names,
 * `required` arrays, `nullable` for the conditional fields the model may emit
 * as `null`). Gemini emits only `ExtractionContent`; generation metadata is
 * assembled by the provider.
 *
 * `validateExtractionContent` is the canonical Zod validator the spec assigns
 * to the Guest's extraction pipeline. The wire schema uses one `anyOf`
 * variant per `timing.kind` so each kind's contract-required fields are
 * required at generation time; Zod still enforces what the wire schema
 * cannot express — foreign-`kind` field absence, the cross-field
 * required-conditionals (`documentTypeLabel` iff `OTHER`, `statusExplanation`
 * iff non-`COMPLETE`), the 200-word summary cap, BCP 47 `sourceLanguage`,
 * quote bounds, one-based `page`, and the list caps.
 * Model-emitted `null`s normalize to absent — shape fixups, not semantic
 * coercion; nothing else is repaired silently.
 */
// One literal list per enum feeds both the wire schema and the Zod validator;
// the `satisfies` pins them to the contract's union types so drift fails here.
const DOCUMENT_TYPES = [
  'TENANCY_AGREEMENT',
  'HEALTH_INSURANCE',
  'EMPLOYMENT_CONTRACT',
  'INTERNET_OR_PHONE',
  'GOVERNMENT_LETTER',
  'OTHER',
] as const satisfies readonly DocumentType[];

const EXTRACTION_STATUSES = [
  'COMPLETE',
  'INSUFFICIENT_CONTENT',
  'UNSUPPORTED_DOCUMENT',
] as const satisfies readonly ExtractionStatus[];

const CADENCES = ['WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY'] as const satisfies readonly RecurrenceCadence[];

const NOTICE_UNITS = ['DAYS', 'WEEKS', 'MONTHS', 'YEARS'] as const satisfies readonly NoticeUnit[];

const TIMING_KINDS = [
  'FIXED_DATE',
  'RECURRING',
  'NOTICE_PERIOD',
  'NONE',
] as const satisfies readonly ActionTimingKind[];

export const extractionResponseSchema: SchemaRequest = {
  type: 'object',
  properties: {
    documentType: {
      type: 'string',
      enum: [...DOCUMENT_TYPES],
    },
    documentTypeLabel: { type: 'string', nullable: true },
    sourceLanguage: { type: 'string' },
    plainEnglishSummary: { type: 'string' },
    extractionStatus: {
      type: 'string',
      enum: [...EXTRACTION_STATUSES],
    },
    statusExplanation: { type: 'string', nullable: true },
    actionItems: {
      type: 'array',
      minItems: 0,
      maxItems: 6,
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          sourceQuote: { type: 'string' },
          page: { type: 'integer', minimum: 1, nullable: true },
          timing: {
            // One variant per kind: each declares and requires exactly the
            // contract's fields for that kind, so a required field can no
            // longer be omitted at generation time. Foreign-kind fields
            // stay undeclared — Zod still audits for their absence.
            anyOf: [
              {
                type: 'object',
                properties: {
                  kind: { type: 'string', enum: ['FIXED_DATE'] },
                  dueDate: { type: 'string' },
                },
                required: ['kind', 'dueDate'],
              },
              {
                type: 'object',
                properties: {
                  kind: { type: 'string', enum: ['RECURRING'] },
                  cadence: { type: 'string', enum: [...CADENCES] },
                  dayOfMonth: { type: 'integer', minimum: 1, maximum: 31, nullable: true },
                  scheduleLabel: { type: 'string' },
                },
                required: ['kind', 'cadence', 'scheduleLabel'],
              },
              {
                type: 'object',
                properties: {
                  kind: { type: 'string', enum: ['NOTICE_PERIOD'] },
                  duration: { type: 'integer', minimum: 1 },
                  unit: { type: 'string', enum: [...NOTICE_UNITS] },
                  anchor: { type: 'string' },
                },
                required: ['kind', 'duration', 'unit', 'anchor'],
              },
              {
                type: 'object',
                properties: {
                  kind: { type: 'string', enum: ['NONE'] },
                },
                required: ['kind'],
              },
            ],
          },
        },
        required: ['text', 'sourceQuote', 'timing'],
      },
    },
    keyTakeaways: {
      type: 'array',
      minItems: 0,
      maxItems: 10,
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          sourceQuote: { type: 'string' },
          page: { type: 'integer', minimum: 1, nullable: true },
        },
        required: ['text', 'sourceQuote'],
      },
    },
  },
  required: [
    'documentType',
    'sourceLanguage',
    'plainEnglishSummary',
    'extractionStatus',
    'actionItems',
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

const optionalNullish = <T extends z.ZodType>(schema: T) =>
  schema.nullish().transform((v) => v ?? undefined);

const page = optionalNullish(z.number().int().min(1));

const isCalendarDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
};

const timingSchema = z
  .object({
    kind: z.enum(TIMING_KINDS),
    dueDate: optionalNullish(z.string()),
    cadence: optionalNullish(z.enum(CADENCES)),
    dayOfMonth: optionalNullish(z.number().int().min(1).max(31)),
    scheduleLabel: optionalNullish(z.string()),
    duration: optionalNullish(z.number().int().min(1)),
    unit: optionalNullish(z.enum(NOTICE_UNITS)),
    anchor: optionalNullish(z.string()),
  })
  .transform((raw, ctx): ActionTiming => {
    const { kind, ...fields } = raw;
    const allowed: Record<ActionTimingKind, readonly string[]> = {
      FIXED_DATE: ['dueDate'],
      RECURRING: ['cadence', 'dayOfMonth', 'scheduleLabel'],
      NOTICE_PERIOD: ['duration', 'unit', 'anchor'],
      NONE: [],
    };
    const fail = (field: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [field], message });
    for (const [field, value] of Object.entries(fields)) {
      if (value !== undefined && !allowed[kind].includes(field)) {
        fail(field, `${field} must be absent for timing kind ${kind}`);
      }
    }
    const required = (field: string) =>
      fail(field, `${field} is required for timing kind ${kind}`);
    const label = (field: 'scheduleLabel' | 'anchor', max: number) => {
      const value = fields[field];
      if (!value) required(field);
      else if (value.length > max) fail(field, `${field} must be 1-${max} characters`);
    };
    if (kind === 'FIXED_DATE') {
      if (!fields.dueDate) required('dueDate');
      else if (!isCalendarDate(fields.dueDate)) {
        fail('dueDate', 'dueDate must be a valid ISO YYYY-MM-DD date');
      }
    } else if (kind === 'RECURRING') {
      if (!fields.cadence) required('cadence');
      label('scheduleLabel', 60);
    } else if (kind === 'NOTICE_PERIOD') {
      if (fields.duration === undefined) required('duration');
      if (!fields.unit) required('unit');
      label('anchor', 80);
    }
    const present = Object.fromEntries(
      Object.entries(fields).filter(([, value]) => value !== undefined),
    );
    return { kind, ...present } as ActionTiming;
  });

const keyTakeawaySchema = z.object({
  text: z.string().min(1),
  sourceQuote: z.string().min(1).max(500),
  page,
});

const actionItemSchema = keyTakeawaySchema.extend({ timing: timingSchema });

export const extractionContentSchema = z
  .object({
    documentType: z.enum(DOCUMENT_TYPES),
    documentTypeLabel: optionalNullish(z.string()),
    sourceLanguage: z.string().refine(isBcp47, 'sourceLanguage must be a BCP 47 tag'),
    plainEnglishSummary: z
      .string()
      .refine((s) => wordCount(s) <= 200, 'plainEnglishSummary exceeds 200 words'),
    extractionStatus: z.enum(EXTRACTION_STATUSES),
    statusExplanation: optionalNullish(z.string()),
    actionItems: z.array(actionItemSchema).min(0).max(6),
    keyTakeaways: z.array(keyTakeawaySchema).min(0).max(10),
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
    if (!complete && (content.actionItems.length > 0 || content.keyTakeaways.length > 0)) {
      ctx.addIssue({
        code: 'custom',
        path: ['actionItems'],
        message: 'actionItems and keyTakeaways must be empty for non-COMPLETE statuses',
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
