// Runs under `pnpm test:integration` — inside `firebase emulators:exec`
// (issue #27). Exercises the real Firestore/Storage implementations against
// the committed rules, as the signed-in owner, per the #9 repository boundary.
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DocumentRecord } from './document';
import { FirestoreDocumentRepository } from './document-repository';
import { emulatorHost } from './testing';

describe('FirestoreDocumentRepository (emulator)', () => {
  let repo: FirestoreDocumentRepository;
  const created: string[] = [];

  beforeEach(async () => {
    const host = await emulatorHost();
    repo = new FirestoreDocumentRepository(host.firestore, host.storage, host.uid);
  });

  afterEach(async () => {
    for (const id of created) await repo.delete(id).catch(() => undefined);
    created.length = 0;
  });

  async function create(input: Parameters<FirestoreDocumentRepository['create']>[0]) {
    const record = await repo.create(input);
    created.push(record.id);
    return record;
  }

  it('creates uploading metadata first — the metadata-first machine (issue #9)', async () => {
    const { uid } = await emulatorHost();
    const record = await create({
      title: 'Mietvertrag 2024',
      originalFilename: 'mietvertrag-2024.pdf',
      sizeBytes: 1234,
      folderId: 'wohnung',
    });

    expect(record).toMatchObject({
      ownerId: uid,
      title: 'Mietvertrag 2024',
      originalFilename: 'mietvertrag-2024.pdf',
      contentType: 'application/pdf',
      sizeBytes: 1234,
      status: 'uploading',
      folderId: 'wohnung',
    });
    expect(record.storagePath).toBe(`users/${uid}/documents/${record.id}.pdf`);
    // Server timestamps, not client clocks.
    expect(record.createdAt.seconds).toBeGreaterThan(0);
    expect(record.updatedAt.seconds).toBeGreaterThan(0);
  });

  it('lists created Documents', async () => {
    const record = await create({
      title: 'Brief vom Finanzamt',
      originalFilename: 'brief.pdf',
      sizeBytes: 10,
      folderId: null,
    });

    const listed = await repo.list();
    const mine = listed.filter((d) => created.includes(d.id));
    expect(mine.map((d) => d.id)).toContain(record.id);
  });

  it('uploads bytes under the Document storage path and reads them back', async () => {
    const record = await create({
      title: 'Rechnung',
      originalFilename: 'rechnung.pdf',
      sizeBytes: 4,
      folderId: null,
    });
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // "%PDF"
    const fractions: number[] = [];

    const upload = repo.uploadBytes(record.id, new Blob([bytes], { type: 'application/pdf' }), (
      bytesTransferred,
      totalBytes,
    ) => fractions.push(bytesTransferred / totalBytes));
    await upload.result;

    expect(fractions.at(-1)).toBe(1);
    const read = await repo.getBytes(record.id);
    expect(new Uint8Array(read)).toEqual(bytes);
  });

  it('setStatus persists machine transitions', async () => {
    const record = await create({
      title: 'Vertrag',
      originalFilename: 'vertrag.pdf',
      sizeBytes: 4,
      folderId: 'vertraege',
    });

    await repo.setStatus(record.id, 'ready');

    const listed = await repo.list();
    expect(listed.find((d) => d.id === record.id)?.status).toBe('ready');
  });

  it('rename edits the title only — originalFilename is immutable provenance', async () => {
    const record = await create({
      title: 'vertrag',
      originalFilename: 'vertrag.pdf',
      sizeBytes: 4,
      folderId: null,
    });

    await repo.rename(record.id, 'Mietvertrag 2024');

    const listed = await repo.list();
    const renamed = listed.find((d) => d.id === record.id);
    expect(renamed?.title).toBe('Mietvertrag 2024');
    expect(renamed?.originalFilename).toBe('vertrag.pdf');
  });

  it('setFolder re-files the Document', async () => {
    const record = await create({
      title: 'Rechnung',
      originalFilename: 'rechnung.pdf',
      sizeBytes: 4,
      folderId: null,
    });

    await repo.setFolder(record.id, 'wohnung');

    const listed = await repo.list();
    expect(listed.find((d) => d.id === record.id)?.folderId).toBe('wohnung');
  });

  it('records and clears the Extraction Job failure (issue #31)', async () => {
    const record = await create({
      title: 'Versicherung',
      originalFilename: 'versicherung.pdf',
      sizeBytes: 4,
      folderId: null,
    });
    expect(record.extractionFailure).toBeNull();

    const failure = {
      code: 'AI_UNAVAILABLE' as const,
      message: 'The document assistant is not responding.',
      retryable: true,
    };
    await repo.setExtractionFailure(record.id, failure);
    const recorded = (await repo.list()).find((d) => d.id === record.id)?.extractionFailure;
    expect(recorded).toMatchObject(failure);
    // Server timestamps, not client clocks.
    expect(recorded?.failedAt.seconds).toBeGreaterThan(0);

    await repo.setExtractionFailure(record.id, null);
    expect(
      (await repo.list()).find((d) => d.id === record.id)?.extractionFailure,
    ).toBeNull();
  });

  it('watch emits the live library on every metadata change until unsubscribed', async () => {
    const emissions: DocumentRecord[][] = [];
    const unwatch = repo.watch((documents) => emissions.push(documents));
    try {
      const record = await create({
        title: 'Mahnung',
        originalFilename: 'mahnung.pdf',
        sizeBytes: 4,
        folderId: null,
      });
      await waitFor(() =>
        emissions.some((docs) => docs.some((d) => d.id === record.id && d.status === 'uploading')),
      );

      await repo.setStatus(record.id, 'ready');
      await waitFor(() =>
        emissions.some((docs) => docs.some((d) => d.id === record.id && d.status === 'ready')),
      );
    } finally {
      unwatch();
    }
  });

  it('deletes bytes → Extraction → metadata, and re-runs to completion (retryable)', async () => {
    const host = await emulatorHost();
    const spy = new OrderingSpyRepository(host.firestore, host.storage, host.uid);
    const record = await spy.create({
      title: 'Kündigung',
      originalFilename: 'kuendigung.pdf',
      sizeBytes: 4,
      folderId: null,
    });
    created.push(record.id);
    await spy.uploadBytes(record.id, pdfBlob()).result;
    const extractionRef = doc(
      host.firestore,
      'users',
      host.uid,
      'documents',
      record.id,
      'extractions',
      'current',
    );
    await setDoc(extractionRef, { marker: true });

    await spy.delete(record.id);

    // The decided order (issues #9/#16): bytes first, metadata last.
    expect(spy.stages).toEqual(['bytes', 'extraction', 'metadata']);
    // Nothing survives the teardown.
    await expect(spy.getBytes(record.id)).rejects.toMatchObject({
      code: 'storage/object-not-found',
    });
    expect((await getDoc(extractionRef)).exists()).toBe(false);
    expect((await spy.list()).find((d) => d.id === record.id)).toBeUndefined();
    // An interrupted `deleting` re-runs to completion — no stage left behind.
    await expect(spy.delete(record.id)).resolves.toBeUndefined();
  });
});

function pdfBlob(): Blob {
  return new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])], { type: 'application/pdf' });
}

/** Polls a condition against emulator-driven snapshot timing. */
async function waitFor(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** Records the real teardown order by spying the protected stage methods. */
class OrderingSpyRepository extends FirestoreDocumentRepository {
  readonly stages: string[] = [];

  override async deleteBytes(documentId: string): Promise<void> {
    await super.deleteBytes(documentId);
    this.stages.push('bytes');
  }

  override async deleteExtraction(documentId: string): Promise<void> {
    await super.deleteExtraction(documentId);
    this.stages.push('extraction');
  }

  override async deleteMetadata(documentId: string): Promise<void> {
    await super.deleteMetadata(documentId);
    this.stages.push('metadata');
  }
}
