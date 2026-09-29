/**
 * The Folder tree as pure functions (issue #33, ADR 0005): the Host loads the
 * whole `folders` collection and builds the tree in memory. Nothing here
 * touches Firestore — the sidebar, tile grid, pickers and the recursive
 * delete all read the same derived shape.
 */
import type { DocumentRecord } from './document';
import type { FolderRecord } from './folder';

/** A Folder with its children, sorted, and recursive counts for the badges. */
export interface FolderNode {
  folder: FolderRecord;
  folders: FolderNode[];
  documents: DocumentRecord[];
  /** Documents at any depth below, excluding `deleting` ones. */
  deepDocumentCount: number;
  /** Folders at any depth below. */
  deepFolderCount: number;
}

/** The synthetic root ("Documents"): top-level Folders and root Documents. */
export interface FolderTree {
  folders: FolderNode[];
  documents: DocumentRecord[];
}

const collator = new Intl.Collator('de');

/** German-locale name ordering shared by the tree, the grid and the pickers. */
export function compareNames(a: string, b: string): number {
  return collator.compare(a, b);
}

export function buildFolderTree(
  folders: readonly FolderRecord[],
  documents: readonly DocumentRecord[],
): FolderTree {
  const childFolders = groupBy(folders, (f) => f.parentId);
  const childDocuments = groupBy(documents, (d) => d.folderId);

  const node = (folder: FolderRecord): FolderNode => {
    const children = (childFolders.get(folder.id) ?? [])
      .map(node)
      .sort((a, b) => compareNames(a.folder.name, b.folder.name));
    const own = (childDocuments.get(folder.id) ?? []).sort((a, b) =>
      compareNames(a.title, b.title),
    );
    return {
      folder,
      folders: children,
      documents: own,
      deepDocumentCount:
        own.filter((d) => d.status !== 'deleting').length +
        children.reduce((sum, c) => sum + c.deepDocumentCount, 0),
      deepFolderCount: children.reduce((sum, c) => sum + 1 + c.deepFolderCount, 0),
    };
  };

  return {
    folders: (childFolders.get(null) ?? [])
      .map(node)
      .sort((a, b) => compareNames(a.folder.name, b.folder.name)),
    documents: (childDocuments.get(null) ?? []).sort((a, b) => compareNames(a.title, b.title)),
  };
}

/** Whether `folderId` may be re-parented under `targetId` — no self/descendant targets. */
export function canMoveFolder(
  folders: readonly FolderRecord[],
  folderId: string,
  targetId: string | null,
): boolean {
  const byId = new Map(folders.map((f) => [f.id, f]));
  let current = targetId;
  const seen = new Set<string>();
  while (current !== null && !seen.has(current)) {
    if (current === folderId) return false;
    seen.add(current);
    current = byId.get(current)?.parentId ?? null;
  }
  return true;
}

/** Sibling names are unique per parent, case-insensitive and trimmed (ADR 0005). */
export function siblingNameTaken(
  folders: readonly FolderRecord[],
  parentId: string | null,
  name: string,
  excludeId?: string,
): boolean {
  const wanted = normalizeName(name);
  return folders.some(
    (f) => f.parentId === parentId && f.id !== excludeId && normalizeName(f.name) === wanted,
  );
}

/**
 * Everything a recursive delete touches: Folder ids deepest-first (the target
 * last) and every Document filed anywhere in the subtree, whatever its status.
 */
export function folderSubtree(
  folders: readonly FolderRecord[],
  documents: readonly DocumentRecord[],
  folderId: string,
): { folderIds: string[]; documents: DocumentRecord[] } {
  const childFolders = groupBy(folders, (f) => f.parentId);
  const folderIds: string[] = [];
  const visit = (id: string): void => {
    for (const child of childFolders.get(id) ?? []) visit(child.id);
    folderIds.push(id);
  };
  visit(folderId);
  const inTree = new Set(folderIds);
  return {
    folderIds,
    documents: documents.filter((d) => d.folderId !== null && inTree.has(d.folderId)),
  };
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

function groupBy<T, K>(items: readonly T[], key: (item: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const group = groups.get(k);
    if (group) group.push(item);
    else groups.set(k, [item]);
  }
  return groups;
}
