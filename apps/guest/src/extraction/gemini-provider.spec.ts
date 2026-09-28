import { describe, expect, it, vi } from 'vitest';
import {
  AIError,
  AIErrorCode,
  type GenerateContentRequest,
  type GenerateContentResult,
} from 'firebase/ai';
import type { ExtractionContent, JobDocument } from '@klartext/bus-contract';
import { createGeminiExtractionProvider, type GeminiModel } from './gemini-provider';
import { EXTRACTION_PROMPT, EXTRACTION_PROMPT_VERSION } from './prompt';

/**
 * The Gemini provider seam (issue #30): the AI Logic SDK is mocked at the
 * `GenerativeModel.generateContent` surface — no network, no Firebase app.
 */

const MODEL_ID = 'gemini-2.5-flash';

const DOCUMENT: JobDocument = {
  documentId: 'doc-finanzamt',
  documentTitle: 'Brief vom Finanzamt',
  contentType: 'application/pdf',
};

const CONTENT: ExtractionContent = {
  documentType: 'GOVERNMENT_LETTER',
  documentTypeLabel: 'Tax office letter',
  sourceLanguage: 'de',
  plainEnglishSummary: 'The tax office reminds you to file your 2023 income tax return.',
  extractionStatus: 'COMPLETE',
  keyTakeaways: [
    {
      text: 'File your 2023 tax return by 31 July 2024, or a late-filing fee may be charged.',
      importance: 'CRITICAL',
      sourceQuote: 'bis zum 31.07.2024 … Verspätungszuschlag',
      page: 1,
    },
  ],
};

function result(text: string, usageMetadata?: unknown): GenerateContentResult {
  return {
    response: {
      text: () => text,
      usageMetadata,
    } as GenerateContentResult['response'],
  };
}

function fakeModel(responses: Array<GenerateContentResult | Error>): {
  model: GeminiModel;
  requests: GenerateContentRequest[];
} {
  const requests: GenerateContentRequest[] = [];
  const queue = [...responses];
  return {
    requests,
    model: {
      generateContent: vi.fn(async (request: GenerateContentRequest) => {
        requests.push(request);
        const next = queue.shift();
        if (next instanceof Error) throw next;
        if (!next) throw new Error('unexpected extra generateContent call');
        return next;
      }),
    },
  };
}

const PDF_BYTES = new TextEncoder().encode('%PDF-1.4 fake').buffer as ArrayBuffer;

describe('gemini provider — happy path', () => {
  it('sends the v1 prompt and inline PDF bytes, returns a validated candidate', async () => {
    const { model, requests } = fakeModel([
      result(JSON.stringify(CONTENT), {
        promptTokenCount: 3011,
        candidatesTokenCount: 240,
        totalTokenCount: 3251,
      }),
    ]);
    const provider = createGeminiExtractionProvider(model, MODEL_ID);

    const candidate = await provider.extract(DOCUMENT, PDF_BYTES);

    expect(candidate).toEqual({
      ...CONTENT,
      documentId: 'doc-finanzamt',
      schemaVersion: 1,
      promptVersion: EXTRACTION_PROMPT_VERSION,
      model: MODEL_ID,
      usage: { promptTokens: 3011, candidatesTokens: 240, totalTokens: 3251 },
    });

    expect(requests).toHaveLength(1);
    const parts = requests[0]!.contents[0]!.parts;
    expect(parts[0]).toEqual({ text: EXTRACTION_PROMPT });
    const inline = parts[1] as { inlineData: { mimeType: string; data: string } };
    expect(inline.inlineData.mimeType).toBe('application/pdf');
    expect(atob(inline.inlineData.data)).toBe('%PDF-1.4 fake');
  });

  it('omits usage when the SDK reports none', async () => {
    const { model } = fakeModel([result(JSON.stringify(CONTENT))]);
    const provider = createGeminiExtractionProvider(model, MODEL_ID);
    const candidate = await provider.extract(DOCUMENT, PDF_BYTES);
    expect(candidate.usage).toBeUndefined();
    expect('usage' in candidate).toBe(false);
  });
});

describe('gemini provider — repair pass', () => {
  const INVALID = { ...CONTENT, extractionStatus: 'INSUFFICIENT_CONTENT' };

  it('re-prompts once with the validation errors, then succeeds', async () => {
    const { model, requests } = fakeModel([
      result(JSON.stringify(INVALID)),
      result(JSON.stringify({ ...INVALID, statusExplanation: 'Blank scan.' })),
    ]);
    const provider = createGeminiExtractionProvider(model, MODEL_ID);

    const candidate = await provider.extract(DOCUMENT, PDF_BYTES);
    expect(candidate.extractionStatus).toBe('INSUFFICIENT_CONTENT');
    expect(candidate.statusExplanation).toBe('Blank scan.');

    expect(requests).toHaveLength(2);
    const repair = requests[1]!;
    // The repair request carries the invalid JSON and the validation errors —
    // and does not upload the PDF again (issue #8).
    const text = (repair.contents[0]!.parts[0] as { text: string }).text;
    expect(text).toContain('statusExplanation');
    expect(text).toContain(JSON.stringify(INVALID));
    expect(repair.contents[0]!.parts.every((p) => !('inlineData' in p))).toBe(true);
  });

  it('repairs a non-JSON response too', async () => {
    const { model, requests } = fakeModel([
      result('sorry, I cannot read this'),
      result(JSON.stringify(CONTENT)),
    ]);
    const provider = createGeminiExtractionProvider(model, MODEL_ID);
    const candidate = await provider.extract(DOCUMENT, PDF_BYTES);
    expect(candidate.documentId).toBe('doc-finanzamt');
    expect(requests).toHaveLength(2);
  });

  it('fails closed with INVALID_EXTRACTION when repair is still invalid', async () => {
    const { model, requests } = fakeModel([
      result(JSON.stringify(INVALID)),
      result(JSON.stringify(INVALID)),
    ]);
    const provider = createGeminiExtractionProvider(model, MODEL_ID);

    await expect(provider.extract(DOCUMENT, PDF_BYTES)).rejects.toEqual({
      code: 'INVALID_EXTRACTION',
      message: expect.any(String),
      retryable: true,
    });
    // Exactly one repair attempt — no retry loop (ADR 0007).
    expect(requests).toHaveLength(2);
  });
});

describe('gemini provider — typed error mapping', () => {
  const httpError = (status: number, statusText = '') =>
    new AIError(AIErrorCode.FETCH_ERROR, `fetch failed [${status} ${statusText}]`, {
      status,
      statusText,
    });

  it('maps HTTP 429 to QUOTA_EXCEEDED without a repair attempt', async () => {
    const { model, requests } = fakeModel([httpError(429, 'Too Many Requests')]);
    const provider = createGeminiExtractionProvider(model, MODEL_ID);
    await expect(provider.extract(DOCUMENT, PDF_BYTES)).rejects.toEqual({
      code: 'QUOTA_EXCEEDED',
      message: expect.any(String),
      retryable: true,
    });
    expect(requests).toHaveLength(1);
  });

  it.each([401, 403])('maps HTTP %i to APP_CHECK_FAILED', async (status) => {
    const { model } = fakeModel([httpError(status, 'Forbidden')]);
    const provider = createGeminiExtractionProvider(model, MODEL_ID);
    await expect(provider.extract(DOCUMENT, PDF_BYTES)).rejects.toMatchObject({
      code: 'APP_CHECK_FAILED',
      retryable: true,
    });
  });

  it('maps other AIError failures (e.g. network) to AI_UNAVAILABLE', async () => {
    const { model } = fakeModel([
      new AIError(AIErrorCode.FETCH_ERROR, 'network unreachable'),
    ]);
    const provider = createGeminiExtractionProvider(model, MODEL_ID);
    await expect(provider.extract(DOCUMENT, PDF_BYTES)).rejects.toMatchObject({
      code: 'AI_UNAVAILABLE',
      retryable: true,
    });
  });

  it('maps SDK misconfiguration to a non-retryable UNKNOWN', async () => {
    const { model } = fakeModel([
      new AIError(AIErrorCode.INVALID_SCHEMA, 'bad schema'),
    ]);
    const provider = createGeminiExtractionProvider(model, MODEL_ID);
    await expect(provider.extract(DOCUMENT, PDF_BYTES)).rejects.toMatchObject({
      code: 'UNKNOWN',
      retryable: false,
    });
  });

  it('maps non-SDK errors to UNKNOWN', async () => {
    const { model } = fakeModel([new TypeError('boom')]);
    const provider = createGeminiExtractionProvider(model, MODEL_ID);
    await expect(provider.extract(DOCUMENT, PDF_BYTES)).rejects.toMatchObject({
      code: 'UNKNOWN',
      retryable: true,
    });
  });
});
