// Runs under `pnpm test:integration` — inside `firebase emulators:exec`
// (issue #27). Drives the real state machine end to end: metadata-first
// uploads against the live Firestore/Storage emulators, cancel with partial
// bytes, failure retention and retry, teardown, and startup reconciliation.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DocumentRecord } from './document';
import { FirestoreDocumentRepository } from './document-repository';
import { emulatorHost } from './testing';
import { UploadCancelledError, UploadPipeline } from './upload-pipeline';

/** Fails the first upload of the suite with a simulated Storage outage. */
class OutageThenRealRepository extends FirestoreDocumentRepository {
  private failedOnce = false;

  override uploadBytes(
    documentId: string,
    data: Blob,
    onProgress?: (bytesTransferred: number, totalBytes: number) => void,
  ) {
    if (!this.failedOnce) {
      this.failedOnce = true;
      return {
        cancel: () => undefined,
        result: Promise.reject(new Error('simulated storage outage')),
      };
    }
    return super.uploadBytes(documentId, data, onProgress);
  }
}

function pdfFile(name: string, sizeBytes = 4): File {
  return new File([new Uint8Array(sizeBytes)], name, { type: 'application/pdf' });
}

/** Big enough that a real resumable upload can't finish before `cancel()`. */
function largePdfFile(name: string): File {
  return new File([new Uint8Array(8 * 1024 * 1024)], name, { type: 'application/pdf' });
}

describe('UploadPipeline (emulator)', () => {
  let repo: FirestoreDocumentRepository;
  let pipeline: UploadPipeline;
  const created: string[] = [];

  beforeEach(async () => {
    const host = await emulatorHost();
    repo = new FirestoreDocumentRepository(host.firestore, host.storage, host.uid);
    pipeline = new UploadPipeline(repo);
  });

  afterEach(async () => {
    for (const id of created) await repo.delete(id).catch(() => undefined);
    created.length = 0;
  });

  function mine(documents: DocumentRecord[]): DocumentRecord[] {
    return documents.filter((d) => created.includes(d.id));
  }

  it('runs the full machine: uploading metadata → bytes land → ready', async () => {
    const handle = await pipeline.upload(pdfFile('mietvertrag.pdf'), { folderId: 'wohnung' });
    created.push(handle.documentId);
    await handle.completion;

    const record = mine(await repo.list()).find((d) => d.id === handle.documentId);
    expect(record).toMatchObject({ title: 'mietvertrag', folderId: 'wohnung', status: 'ready' });
    // The bytes are the Document's — downloadable again (#16 Download).
    await expect(repo.getBytes(handle.documentId)).resolves.toBeInstanceOf(ArrayBuffer);
  });

  it('runs concurrent uploads, each with per-upload progress', async () => {
    const progressA: number[] = [];
    const progressB: number[] = [];
    const a = await pipeline.upload(pdfFile('erste.pdf'), { onProgress: (f) => progressA.push(f) });
    const b = await pipeline.upload(pdfFile('zweite.pdf'), { onProgress: (f) => progressB.push(f) });
    created.push(a.documentId, b.documentId);
    await Promise.all([a.completion, b.completion]);

    const records = mine(await repo.list());
    expect(records.find((d) => d.id === a.documentId)?.status).toBe('ready');
    expect(records.find((d) => d.id === b.documentId)?.status).toBe('ready');
    expect(progressA.at(-1)).toBe(1);
    expect(progressB.at(-1)).toBe(1);
  });

  it('marks a failed upload failed and retains metadata for retry', async () => {
    const host = await emulatorHost();
    const flaky = new OutageThenRealRepository(host.firestore, host.storage, host.uid);
    const flakyPipeline = new UploadPipeline(flaky);

    const handle = await flakyPipeline.upload(pdfFile('rechnung.pdf'));
    created.push(handle.documentId);
    await expect(handle.completion).rejects.toThrow('simulated storage outage');

    const record = mine(await repo.list()).find((d) => d.id === handle.documentId);
    expect(record?.status).toBe('failed');
  });

  it('retries a failed upload under the same documentId — bytes land, ready', async () => {
    const host = await emulatorHost();
    const flaky = new OutageThenRealRepository(host.firestore, host.storage, host.uid);
    const flakyPipeline = new UploadPipeline(flaky);

    const failed = await flakyPipeline.upload(pdfFile('kuendigung.pdf'));
    created.push(failed.documentId);
    await expect(failed.completion).rejects.toThrow('simulated storage outage');

    const retried = await flakyPipeline.retryUpload(failed.documentId, pdfFile('kuendigung.pdf'));
    expect(retried.documentId).toBe(failed.documentId);
    await retried.completion;

    const record = mine(await repo.list()).find((d) => d.id === failed.documentId);
    expect(record?.status).toBe('ready');
    await expect(repo.getBytes(failed.documentId)).resolves.toBeInstanceOf(ArrayBuffer);
  });

  it('cancel deletes metadata and partial bytes — the Document never existed', async () => {
    const handle = await pipeline.upload(largePdfFile('abrechnung.pdf'));

    handle.cancel();
    await expect(handle.completion).rejects.toThrow(UploadCancelledError);
    // Cancel races nothing: the document id was never published to the suite.
    expect(mine(await repo.list()).find((d) => d.id === handle.documentId)).toBeUndefined();
    await expect(repo.getBytes(handle.documentId)).rejects.toMatchObject({
      code: 'storage/object-not-found',
    });
  });

  it('deletes a ready Document: bytes → Extraction → metadata', async () => {
    const handle = await pipeline.upload(pdfFile('bescheid.pdf'));
    created.push(handle.documentId);
    await handle.completion;

    await pipeline.delete(handle.documentId);

    expect(mine(await repo.list()).find((d) => d.id === handle.documentId)).toBeUndefined();
    await expect(repo.getBytes(handle.documentId)).rejects.toMatchObject({
      code: 'storage/object-not-found',
    });
  });

  it('reconciles on startup: uploading without a live task → failed, deleting → gone', async () => {
    const orphan = await repo.create({
      title: 'orphan',
      originalFilename: 'orphan.pdf',
      sizeBytes: 4,
      folderId: null,
    });
    created.push(orphan.id);
    const doomed = await repo.create({
      title: 'doomed',
      originalFilename: 'doomed.pdf',
      sizeBytes: 4,
      folderId: null,
    });
    created.push(doomed.id);
    await repo.setStatus(doomed.id, 'deleting');

    await pipeline.reconcile(await repo.list());

    const records = mine(await repo.list());
    expect(records.find((d) => d.id === orphan.id)?.status).toBe('failed');
    expect(records.find((d) => d.id === doomed.id)).toBeUndefined();
  });
});
