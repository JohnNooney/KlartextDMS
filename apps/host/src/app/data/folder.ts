/**
 * Folder metadata schema (ADR 0005): the Firestore record at
 * `users/{uid}/folders/{folderId}`. Folders form a client-side adjacency
 * tree — the Host loads the whole collection and walks `parentId` links.
 * Read-only so far; the Folders issue (#33) adds the write side.
 */
import type { Timestamp } from '@klartext/bus-contract';

export interface FolderRecord {
  id: string;
  /** `name` is the display label; sibling names are unique per #20. */
  name: string;
  /** `null` = root ("Documents"). */
  parentId: string | null;
  status: 'ready' | 'deleting';
  description?: string;
  keywords?: string[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/**
 * The root-first ancestry chain for `folderId` — root itself excluded; the UI
 * prepends "Documents". Unknown/broken links end the walk, so a Folder whose
 * parent is missing still yields a usable chain.
 */
export function folderAncestry(
  folders: readonly FolderRecord[],
  folderId: string | null,
): FolderRecord[] {
  if (folderId === null) return [];
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const chain: FolderRecord[] = [];
  let current = byId.get(folderId);
  while (current) {
    chain.unshift(current);
    current = current.parentId === null ? undefined : byId.get(current.parentId);
  }
  return chain;
}
