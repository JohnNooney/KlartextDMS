// Runs under `pnpm test:integration` — inside `firebase emulators:exec`.
// Exercises the real Firestore FolderRepository against the committed rules (issue #33).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FirestoreFolderRepository } from './folder-repository';
import { emulatorHost } from './testing';

describe('FirestoreFolderRepository (emulator)', () => {
  let repo: FirestoreFolderRepository;
  const created: string[] = [];

  beforeEach(async () => {
    const host = await emulatorHost();
    repo = new FirestoreFolderRepository(host.firestore, host.uid);
  });

  afterEach(async () => {
    for (const id of created) await repo.delete(id).catch(() => undefined);
    created.length = 0;
  });

  async function create(input: Parameters<FirestoreFolderRepository['create']>[0]) {
    const record = await repo.create(input);
    created.push(record.id);
    return record;
  }

  it('creates a ready Folder with server timestamps and optional annotations', async () => {
    const record = await create({
      name: 'Wohnung',
      parentId: null,
      description: 'Rental paperwork',
      keywords: ['miete', 'nebenkosten'],
    });

    expect(record).toMatchObject({
      name: 'Wohnung',
      parentId: null,
      status: 'ready',
      description: 'Rental paperwork',
      keywords: ['miete', 'nebenkosten'],
    });
    expect(record.createdAt.seconds).toBeGreaterThan(0);
    expect(await repo.list()).toContainEqual(expect.objectContaining({ id: record.id }));
  });

  it('omits description and keywords when not given', async () => {
    const record = await create({ name: 'Plain', parentId: null });
    expect('description' in record).toBe(false);
    expect('keywords' in record).toBe(false);
  });

  it('updates name, parent and status, bumping updatedAt', async () => {
    const parent = await create({ name: 'Parent', parentId: null });
    const child = await create({ name: 'Child', parentId: null });

    await repo.update(child.id, { name: 'Renamed', parentId: parent.id });
    await repo.update(child.id, { status: 'deleting' });

    const stored = (await repo.list()).find((f) => f.id === child.id)!;
    expect(stored).toMatchObject({ name: 'Renamed', parentId: parent.id, status: 'deleting' });
    expect(stored.updatedAt.seconds).toBeGreaterThanOrEqual(child.updatedAt.seconds);
  });

  it('deletes idempotently', async () => {
    const record = await create({ name: 'Gone', parentId: null });
    await repo.delete(record.id);
    await repo.delete(record.id);
    expect((await repo.list()).some((f) => f.id === record.id)).toBe(false);
  });

  it('watch pushes the live Folder feed', async () => {
    const seen: string[][] = [];
    const unwatch = repo.watch((folders) => seen.push(folders.map((f) => f.name)));
    const record = await create({ name: 'Live', parentId: null });
    for (let i = 0; i < 50 && !seen.some((names) => names.includes('Live')); i++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    unwatch();
    expect(record.name).toBe('Live');
    expect(seen.some((names) => names.includes('Live'))).toBe(true);
  });
});
