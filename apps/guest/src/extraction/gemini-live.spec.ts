import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { deleteApp } from 'firebase/app';
import { signInAnonymously } from 'firebase/auth';
import { describe, expect, it } from 'vitest';
import type { ExtractDocumentPayload } from '@klartext/bus-contract';
import { initGuestFirebase } from '../firebase';
import { validateExtractionContent } from './extraction-schema';
import { createExtractionJobRunner, EXTRACTION_MODEL } from './run-extraction-job';

/**
 * Opt-in live check — the issue #30 acceptance criterion "a real Gemini
 * round-trip works in dev": real App Check debug-token exchange, real
 * anonymous sign-in, real `generateContent` against the seeded Finanzamt PDF.
 * Skipped unless VERIFY_GEMINI is set, since it costs ~$0.004 per run.
 *
 *   VERIFY_GEMINI=1 pnpm --filter @klartext/guest exec vitest run src/extraction/gemini-live.spec.ts
 * (or `cd apps/guest && VERIFY_GEMINI=1 pnpm vitest run src/extraction/gemini-live.spec.ts`)
 *
 * Prerequisites:
 * - `KLARTEXT_GUEST_DEBUG_TOKEN` in the repo-root `.env`, registered in the
 *   console under web app `1:680865987993:web:cd0a552f35a96915fd6708`.
 * - Anonymous Auth enabled on the project (the Guest's sign-in path, #10).
 * No emulators: `useEmulators: false` — real Auth and real AI Logic.
 */

const RUN = !!process.env.VERIFY_GEMINI;
// Vitest runs with cwd = apps/guest; up two levels to the repo root.
const PDF = readFileSync(resolve(process.cwd(), '../../scripts/fixtures/brief-finanzamt.pdf'));

describe.runIf(RUN)('live Gemini round-trip', () => {
  it('extracts the seeded PDF through the real pipeline', async () => {
    const config = {
      useEmulators: false,
      fakeAiProvider: false,
      appCheckDebugToken: import.meta.env.KLARTEXT_GUEST_DEBUG_TOKEN,
    };
    expect(config.appCheckDebugToken, 'KLARTEXT_GUEST_DEBUG_TOKEN missing from .env').toBeTruthy();

    const { app, auth } = initGuestFirebase(config);
    try {
      await signInAnonymously(auth);

      const runJob = createExtractionJobRunner(config, app);
      const job: ExtractDocumentPayload = {
        jobId: 'verify-gemini-1',
        document: {
          documentId: 'doc-finanzamt',
          documentTitle: 'Brief vom Finanzamt',
          contentType: 'application/pdf',
        },
        bytes: PDF.buffer.slice(PDF.byteOffset, PDF.byteOffset + PDF.byteLength) as ArrayBuffer,
      };

      const candidate = await runJob(job);

      expect(validateExtractionContent(candidate).ok).toBe(true);
      expect(candidate.documentId).toBe('doc-finanzamt');
      expect(candidate.schemaVersion).toBe(1);
      expect(candidate.promptVersion).toBe('klartext-extraction-v1');
      expect(candidate.model).toBe(EXTRACTION_MODEL);
      console.log(
        `[live] ${candidate.extractionStatus} — ${candidate.documentType}, ` +
          `${candidate.keyTakeaways.length} takeaways, ` +
          `${candidate.usage?.totalTokens ?? '?'} tokens`,
      );
    } finally {
      await deleteApp(app);
    }
  }, 60_000);
});
