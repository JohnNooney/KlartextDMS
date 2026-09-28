import { describe, expect, it } from 'vitest';
import type { DocumentRecord } from '../data/document';
import { siblingsOf, stepperFor } from './siblings';

function doc(id: string, title: string, overrides: Partial<DocumentRecord> = {}): DocumentRecord {
  return {
    id,
    ownerId: 'owner',
    title,
    originalFilename: `${id}.pdf`,
    contentType: 'application/pdf',
    sizeBytes: 1,
    storagePath: `users/owner/documents/${id}.pdf`,
    status: 'ready',
    folderId: null,
    createdAt: { seconds: 1, nanoseconds: 0 },
    updatedAt: { seconds: 1, nanoseconds: 0 },
    ...overrides,
  };
}

describe('siblingsOf (issue #29 stepper order)', () => {
  it('orders siblings by title in German collation', () => {
    const docs = [
      doc('z', 'Zebra'),
      doc('ae', 'Änderung'),
      doc('b', 'Berta'),
      doc('a', 'Apfel'),
    ];
    expect(siblingsOf(docs, null).map((d) => d.title)).toEqual([
      'Änderung',
      'Apfel',
      'Berta',
      'Zebra',
    ]);
  });

  it('keeps only openable Documents of the same Folder', () => {
    const docs = [
      doc('a', 'A'),
      doc('b', 'B', { status: 'uploading' }),
      doc('c', 'C', { folderId: 'other' }),
      doc('d', 'D', { status: 'failed' }),
    ];
    expect(siblingsOf(docs, null).map((d) => d.id)).toEqual(['a']);
  });

  it('groups by the Document’s Folder, not the browsed one', () => {
    const docs = [
      doc('a', 'A', { folderId: 'wohnung' }),
      doc('b', 'B', { folderId: 'kranken' }),
      doc('c', 'C'),
    ];
    expect(siblingsOf(docs, 'wohnung').map((d) => d.id)).toEqual(['a']);
    expect(siblingsOf(docs, null).map((d) => d.id)).toEqual(['c']);
  });
});

describe('stepperFor', () => {
  const sibs = [doc('a', 'A'), doc('b', 'B'), doc('c', 'C')];

  it('reports index, total, and neighbours', () => {
    const stepper = stepperFor(sibs, 'b');
    expect(stepper).toMatchObject({ index: 1, total: 3 });
    expect(stepper?.prev?.id).toBe('a');
    expect(stepper?.next?.id).toBe('c');
  });

  it('disables edges: first has no previous, last has no next', () => {
    expect(stepperFor(sibs, 'a')).toMatchObject({ prev: null });
    expect(stepperFor(sibs, 'c')).toMatchObject({ next: null });
  });

  it('is null when the Document is not among its siblings', () => {
    expect(stepperFor(sibs, 'missing')).toBeNull();
    expect(stepperFor([], 'a')).toBeNull();
  });
});
