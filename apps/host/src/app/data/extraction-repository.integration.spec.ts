// Runs under `pnpm test:integration` — inside `firebase emulators:exec`
// (issue #27). Exercises the real Firestore implementation of the
// Extraction repository against the committed rules (ADR 0008: one Extraction
// per Document, persisted at `extractions/current` and reused).
import type { ExtractionCandidate } from '@klartext/bus-contract';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FirestoreDocumentRepository } from './document-repository';
import { FirestoreExtractionRepository } from './extraction-repository';
import { emulatorHost } from './testing';

function candidate(documentId: string): ExtractionCandidate {
  return {
    documentId,
    schemaVersion: 1,
    promptVersion: 'klartext-extraction-v1',
    model: 'gemini-test-model',
    documentType: 'TENANCY_AGREEMENT',
    sourceLanguage: 'de',
    plainEnglishSummary: 'A tenancy agreement with a notice period.',
    extractionStatus: 'COMPLETE',
    keyTakeaways: [],
  };
}

describe('FirestoreExtractionRepository (emulator)', () => {
  let documents: FirestoreDocumentRepository;
  let extractions: FirestoreExtractionRepository;
  let documentId: string;

  beforeEach(async () => {
    const host = await emulatorHost();
    documents = new FirestoreDocumentRepository(host.firestore, host.storage, host.uid);
    extractions = new FirestoreExtractionRepository(host.firestore, host.uid);
    // Extractions live under their Document — create the parent first.
    const record = await documents.create({
      title: 'Mietvertrag',
      originalFilename: 'mietvertrag.pdf',
      sizeBytes: 4,
      folderId: null,
    });
    documentId = record.id;
  });

  afterEach(async () => {
    await documents.delete(documentId).catch(() => undefined);
  });

  it('returns null when no Extraction is stored', async () => {
    await expect(extractions.get(documentId)).resolves.toBeNull();
  });

  it('saves the current Extraction at extractions/current and reads it back', async () => {
    await extractions.save(documentId, candidate(documentId));

    const stored = await extractions.get(documentId);
    expect(stored).toMatchObject(candidate(documentId));
    // The Host adds the Firestore server timestamp (issue #8).
    expect(stored?.createdAt.seconds).toBeGreaterThan(0);
  });

  it('replaces the stored Extraction on re-save — one per Document', async () => {
    const first = candidate(documentId);
    await extractions.save(documentId, first);
    const second = { ...candidate(documentId), plainEnglishSummary: 'Updated reading.' };
    await extractions.save(documentId, second);

    const stored = await extractions.get(documentId);
    expect(stored?.plainEnglishSummary).toBe('Updated reading.');
  });
});
