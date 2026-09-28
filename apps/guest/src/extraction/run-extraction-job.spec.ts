import { describe, expect, it } from 'vitest';
import type { FirebaseApp } from 'firebase/app';
import type { ExtractDocumentPayload } from '@klartext/bus-contract';
import { createExtractionJobRunner } from './run-extraction-job';

/**
 * The runner is the adapter seam (issue #30): provider selection happens once
 * at wiring time, then each Job goes through `extract`. The fake branch never
 * touches the FirebaseApp — the flag alone decides.
 */

const JOB: ExtractDocumentPayload = {
  jobId: 'job_1',
  document: {
    documentId: 'doc-finanzamt',
    documentTitle: 'Brief vom Finanzamt',
    contentType: 'application/pdf',
  },
  bytes: new ArrayBuffer(4),
};

describe('createExtractionJobRunner', () => {
  it('serves seeded fixtures under VITE_FAKE_AI_PROVIDER without touching Firebase', async () => {
    const runJob = createExtractionJobRunner(
      { useEmulators: true, fakeAiProvider: true },
      null as unknown as FirebaseApp,
    );
    const candidate = await runJob(JOB);
    expect(candidate.documentId).toBe('doc-finanzamt');
    expect(candidate.documentType).toBe('GOVERNMENT_LETTER');
  });
});
