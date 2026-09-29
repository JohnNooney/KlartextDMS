import { describe, expect, it } from 'vitest';
import type { DocumentRecord, DocumentStatus } from './document';
import type { FolderRecord } from './folder';
import { buildFolderTree, canMoveFolder, folderSubtree, siblingNameTaken } from './folder-tree';

const ts = { seconds: 1, nanoseconds: 0 };

function folder(id: string, parentId: string | null, name = id): FolderRecord {
  return { id, name, parentId, status: 'ready', createdAt: ts, updatedAt: ts };
}

function doc(id: string, folderId: string | null, status: DocumentStatus = 'ready', title = id) {
  return {
    id,
    title,
    status,
    folderId,
  } as DocumentRecord;
}

describe('buildFolderTree', () => {
  it('nests Folders under their parents, Folders before Documents, each sorted by German locale', () => {
    const tree = buildFolderTree(
      [folder('b', null, 'Zebra'), folder('a', null, 'Äpfel'), folder('c', 'a', 'Steuer')],
      [doc('d2', 'a', 'ready', 'Zeugnis'), doc('d1', 'a', 'ready', 'Ärztebrief'), doc('r', null)],
    );

    expect(tree.folders.map((n) => n.folder.name)).toEqual(['Äpfel', 'Zebra']);
    expect(tree.documents.map((d) => d.id)).toEqual(['r']);
    const apfel = tree.folders[0]!;
    expect(apfel.folders.map((n) => n.folder.name)).toEqual(['Steuer']);
    expect(apfel.documents.map((d) => d.title)).toEqual(['Ärztebrief', 'Zeugnis']);
  });

  it('deep counts cover every nested Document and Folder, excluding deleting Documents', () => {
    const tree = buildFolderTree(
      [folder('a', null), folder('b', 'a'), folder('c', 'b')],
      [
        doc('1', 'a'),
        doc('2', 'b'),
        doc('3', 'c'),
        doc('4', 'c', 'uploading'),
        doc('5', 'c', 'deleting'),
      ],
    );

    const a = tree.folders[0]!;
    expect(a.deepDocumentCount).toBe(4);
    expect(a.deepFolderCount).toBe(2);
    expect(a.folders[0]!.deepDocumentCount).toBe(3);
    expect(a.folders[0]!.folders[0]!.deepFolderCount).toBe(0);
  });

  it('deep Folder counts exclude deleting Folders', () => {
    const gone = { ...folder('b', 'a'), status: 'deleting' as const };
    const tree = buildFolderTree([folder('a', null), gone, folder('c', 'a')], []);
    expect(tree.folders[0]!.deepFolderCount).toBe(1);
  });

  it('treats a Folder with a missing parent as unreachable rather than throwing', () => {
    const tree = buildFolderTree([folder('x', 'ghost')], []);
    expect(tree.folders).toEqual([]);
  });
});

describe('canMoveFolder', () => {
  const folders = [folder('a', null), folder('b', 'a'), folder('c', 'b'), folder('d', null)];

  it('rejects moving a Folder into itself or any descendant', () => {
    expect(canMoveFolder(folders, 'a', 'a')).toBe(false);
    expect(canMoveFolder(folders, 'a', 'b')).toBe(false);
    expect(canMoveFolder(folders, 'a', 'c')).toBe(false);
  });

  it('allows moves to root, siblings and unrelated Folders', () => {
    expect(canMoveFolder(folders, 'c', null)).toBe(true);
    expect(canMoveFolder(folders, 'c', 'd')).toBe(true);
    expect(canMoveFolder(folders, 'b', 'd')).toBe(true);
  });
});

describe('siblingNameTaken', () => {
  const folders = [folder('a', null, 'Steuer'), folder('b', 'a', 'Steuer'), folder('c', null, 'Wohnung')];

  it('is case-insensitive and trimmed within one parent', () => {
    expect(siblingNameTaken(folders, null, '  steuer ')).toBe(true);
    expect(siblingNameTaken(folders, 'a', 'STEUER')).toBe(true);
  });

  it('ignores other parents and the Folder being renamed', () => {
    expect(siblingNameTaken(folders, 'a', 'Wohnung')).toBe(false);
    expect(siblingNameTaken(folders, null, 'Steuer', 'a')).toBe(false);
  });
});

describe('folderSubtree', () => {
  it('lists descendant Folders deepest-first and every contained Document', () => {
    const folders = [folder('a', null), folder('b', 'a'), folder('c', 'b'), folder('d', 'a'), folder('z', null)];
    const documents = [doc('1', 'a'), doc('2', 'c', 'uploading'), doc('3', 'z')];

    const subtree = folderSubtree(folders, documents, 'a');

    expect(subtree.folderIds.at(-1)).toBe('a');
    expect(subtree.folderIds.indexOf('c')).toBeLessThan(subtree.folderIds.indexOf('b'));
    expect([...subtree.folderIds].sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(subtree.documents.map((d) => d.id).sort()).toEqual(['1', '2']);
  });
});
