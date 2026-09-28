import {
  AIError,
  AIErrorCode,
  type GenerateContentRequest,
  type GenerateContentResult,
  type GenerativeModel,
} from 'firebase/ai';
import type {
  ExtractionCandidate,
  ExtractionError,
  JobDocument,
  TokenUsage,
} from '@klartext/bus-contract';
import { validateExtractionContent } from './extraction-schema';
import { EXTRACTION_PROMPT, EXTRACTION_PROMPT_VERSION } from './prompt';
import type { ExtractionProvider } from './extraction-provider';

/**
 * Gemini via Firebase AI Logic (issue #30, ADR 0007): inline `application/pdf`
 * bytes, structured output per the #8 response schema, one repair pass on
 * invalid output, then fail closed with `INVALID_EXTRACTION`.
 *
 * The seam under test is `generateContent` — the model arrives already built
 * (`getAI` + `getGenerativeModel` wiring lives in the provider factory), so
 * specs inject a stub without touching the SDK.
 */

/** The slice of `GenerativeModel` the provider drives. */
export type GeminiModel = Pick<GenerativeModel, 'generateContent'>;

type ReadOutcome =
  | { ok: true; candidate: ExtractionCandidate }
  | { ok: false; raw: string | undefined; issues: string[] };

const INVALID_EXTRACTION: ExtractionError = {
  code: 'INVALID_EXTRACTION',
  message: 'The document assistant produced a response that could not be used.',
  retryable: true,
};

function toBase64(bytes: ArrayBuffer): string {
  const u8 = new Uint8Array(bytes);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < u8.length; i += CHUNK) {
    binary += String.fromCharCode(...u8.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function extractionRequest(document: JobDocument, bytes: ArrayBuffer): GenerateContentRequest {
  return {
    contents: [
      {
        role: 'user',
        parts: [
          { text: EXTRACTION_PROMPT },
          { inlineData: { mimeType: document.contentType, data: toBase64(bytes) } },
        ],
      },
    ],
  };
}

/** The one repair pass: invalid JSON plus its validation errors, no PDF re-upload (issue #8). */
function repairRequest(raw: string | undefined, issues: string[]): GenerateContentRequest {
  const shown = raw === undefined ? '(the response contained no readable text)' : raw;
  return {
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: `${EXTRACTION_PROMPT}

The previous response failed validation against the Extraction schema. Correct it and return only the JSON object the response schema requires; do not add facts the quoted evidence does not support.

Validation errors:
${issues.map((issue) => `- ${issue}`).join('\n')}

Invalid response:
${shown}`,
          },
        ],
      },
    ],
  };
}

function mapUsage(result: GenerateContentResult): TokenUsage | undefined {
  const u = result.response.usageMetadata;
  return (
    u && {
      promptTokens: u.promptTokenCount,
      candidatesTokens: u.candidatesTokenCount,
      totalTokens: u.totalTokenCount,
    }
  );
}

function readCandidate(
  result: GenerateContentResult,
  documentId: string,
  modelId: string,
): ReadOutcome {
  let raw: string;
  try {
    raw = result.response.text();
  } catch {
    return { ok: false, raw: undefined, issues: ['the response contained no readable text'] };
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    return {
      ok: false,
      raw,
      issues: [`the response was not valid JSON (${(err as Error).message})`],
    };
  }
  const validated = validateExtractionContent(json);
  if (!validated.ok) return { ok: false, raw, issues: validated.issues };
  const usage = mapUsage(result);
  return {
    ok: true,
    candidate: {
      ...validated.content,
      documentId,
      schemaVersion: 1,
      promptVersion: EXTRACTION_PROMPT_VERSION,
      model: modelId,
      ...(usage ? { usage } : {}),
    },
  };
}

/** SDK/App Check/quota failures → the contract's typed error codes (issue #30). */
export function toExtractionError(err: unknown): ExtractionError {
  if (err instanceof AIError) {
    const status = err.customErrorData?.status;
    if (status === 429) {
      return {
        code: 'QUOTA_EXCEEDED',
        message: 'The document assistant is busy — try again in a moment.',
        retryable: true,
      };
    }
    if (status === 401 || status === 403) {
      return {
        code: 'APP_CHECK_FAILED',
        message: 'The document assistant could not verify this app — reload the panel and try again.',
        retryable: true,
      };
    }
    switch (err.code) {
      // Misconfiguration at our end — retrying changes nothing.
      case AIErrorCode.INVALID_SCHEMA:
      case AIErrorCode.API_NOT_ENABLED:
      case AIErrorCode.NO_API_KEY:
      case AIErrorCode.NO_APP_ID:
      case AIErrorCode.NO_PROJECT_ID:
      case AIErrorCode.NO_MODEL:
        return { code: 'UNKNOWN', message: 'Extraction failed.', retryable: false };
      default:
        return {
          code: 'AI_UNAVAILABLE',
          message: 'The document assistant is unavailable — try again.',
          retryable: true,
        };
    }
  }
  return { code: 'UNKNOWN', message: 'Extraction failed.', retryable: true };
}

async function generate(model: GeminiModel, request: GenerateContentRequest) {
  try {
    return await model.generateContent(request);
  } catch (err) {
    throw toExtractionError(err);
  }
}

export function createGeminiExtractionProvider(
  model: GeminiModel,
  modelId: string,
): ExtractionProvider {
  return {
    async extract(document, bytes) {
      const first = readCandidate(
        await generate(model, extractionRequest(document, bytes)),
        document.documentId,
        modelId,
      );
      if (first.ok) return first.candidate;

      const repaired = readCandidate(
        await generate(model, repairRequest(first.raw, first.issues)),
        document.documentId,
        modelId,
      );
      if (!repaired.ok) throw INVALID_EXTRACTION;
      return repaired.candidate;
    },
  };
}
