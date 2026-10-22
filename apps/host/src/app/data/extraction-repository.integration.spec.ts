// Runs under `pnpm test:integration` — inside `firebase emulators:exec`
// (issue #27). Exercises the real Firestore implementation of the
// Extraction repository against the committed rules (ADR 0008: one Extraction
// per Document, persisted at `extractions/current` and reused).
import type { ExtractionCandidate, LegacyExtractionRecordV1 } from '@klartext/bus-contract';
import { legacyV1ExtractionFixtures } from '@klartext/bus-contract';
import { setDoc } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { extractionRef } from './paths';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FirestoreDocumentRepository } from './document-repository';
import { FirestoreExtractionRepository } from './extraction-repository';
import { emulatorHost } from './testing';

function candidate(documentId: string): ExtractionCandidate {
  return {
    documentId,
    schemaVersion: 2,
    promptVersion: 'klartext-extraction-v2',
    model: 'gemini-test-model',
    documentType: 'TENANCY_AGREEMENT',
    sourceLanguage: 'de',
    plainEnglishSummary: 'A tenancy agreement with a notice period.',
    extractionStatus: 'COMPLETE',
    actionItems: [
      {
        text: 'Give three months notice.',
        sourceQuote: 'Die Kündigungsfrist beträgt drei Monate.',
        timing: { kind: 'NOTICE_PERIOD', duration: 3, unit: 'MONTHS', anchor: 'moving out' },
      },
    ],
    keyTakeaways: [],
  };
}

describe('FirestoreExtractionRepository (emulator)', () => {
  let documents: FirestoreDocumentRepository;
  let extractions: FirestoreExtractionRepository;
  let documentId: string;
  let firestore: Firestore;
  let ownerId: string;

  beforeEach(async () => {
    const host = await emulatorHost();
    firestore = host.firestore;
    ownerId = host.uid;
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

  it('persists a candidate whose optional fields arrived as explicit undefined', async () => {
    // The Guest's schema validation emits documentTypeLabel / statusExplanation /
    // takeaway page as own-undefined properties; postMessage preserves them and
    // Firestore would reject the write (issue #31).
    const withUndefined = {
      ...candidate(documentId),
      documentTypeLabel: undefined,
      statusExplanation: undefined,
      keyTakeaways: [
        {
          text: 'Notice period is three months.',
          sourceQuote: 'Die Kündigungsfrist beträgt drei Monate.',
          page: undefined,
        },
      ],
    };
    await extractions.save(documentId, withUndefined);

    const stored = await extractions.get(documentId);
    expect(stored).toMatchObject({ documentId, extractionStatus: 'COMPLETE' });
    expect('documentTypeLabel' in stored!).toBe(false);
    expect('statusExplanation' in stored!).toBe(false);
    expect('page' in stored!.keyTakeaways[0]!).toBe(false);
  });

  it('normalizes a stored schemaVersion 1 record on read (ADR 0010)', async () => {
    const legacy: Omit<LegacyExtractionRecordV1, 'createdAt'> = {
      ...legacyV1ExtractionFixtures['doc-versicherungsschein']!,
      documentId,
    };
    await setDoc(extractionRef(firestore, ownerId, documentId), {
      ...legacy,
      createdAt: new Date(),
    });

    const stored = await extractions.get(documentId);
    expect(stored?.schemaVersion).toBe(1);
    expect(stored?.actionItems).toHaveLength(1);
    expect(stored?.actionItems[0]).toMatchObject({ timing: { kind: 'NONE' } });
    expect(stored?.actionItems[0]?.id).toMatch(/^ai_/);
    expect(stored?.keyTakeaways).toHaveLength(1);
    expect(stored?.keyTakeaways[0]).not.toHaveProperty('importance');
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
