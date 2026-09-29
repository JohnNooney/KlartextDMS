/**
 * Host-only Folder persistence (issues #29, #33; ADR 0005). The whole
 * collection stays small enough for a single fetch/live feed — the tree is
 * built client-side, so there is no query beyond "everything".
 */
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  type CollectionReference,
  type Firestore,
} from 'firebase/firestore';
import type { FolderRecord } from './folder';

/** What the New-folder dialog knows — input to `FolderRepository.create`. */
export interface NewFolder {
  name: string;
  /** `null` = root ("Documents"). */
  parentId: string | null;
  description?: string;
  keywords?: string[];
}

/** The editable fields (`status` covers the `deleting` transition). */
export type FolderPatch = Partial<
  Pick<FolderRecord, 'name' | 'parentId' | 'description' | 'keywords' | 'status'>
>;

export interface FolderRepository {
  /** Every Folder in the owner's library, creation order first. */
  list(): Promise<FolderRecord[]>;
  /**
   * The live Folder feed: invokes `listener` with the full list on every
   * Firestore snapshot. Returns the unsubscribe function.
   */
  watch(listener: (folders: FolderRecord[]) => void): () => void;
  /** Writes a `ready` Folder; the server stamps both timestamps. */
  create(input: NewFolder): Promise<FolderRecord>;
  /** Rename, move, annotate, or mark `deleting`; bumps `updatedAt`. */
  update(folderId: string, patch: FolderPatch): Promise<void>;
  /** Removes the Folder record only — contents are the caller's teardown. Idempotent. */
  delete(folderId: string): Promise<void>;
}

export class FirestoreFolderRepository implements FolderRepository {
  constructor(
    private readonly firestore: Firestore,
    private readonly ownerId: string,
  ) {}

  private get folders(): CollectionReference {
    return collection(this.firestore, 'users', this.ownerId, 'folders');
  }

  async list(): Promise<FolderRecord[]> {
    const snap = await getDocs(query(this.folders, orderBy('createdAt')));
    return snap.docs.map((d) => d.data() as FolderRecord);
  }

  watch(listener: (folders: FolderRecord[]) => void): () => void {
    return onSnapshot(query(this.folders, orderBy('createdAt')), (snap) =>
      listener(snap.docs.map((d) => d.data() as FolderRecord)),
    );
  }

  async create(input: NewFolder): Promise<FolderRecord> {
    const ref = doc(this.folders);
    await setDoc(ref, {
      id: ref.id,
      name: input.name,
      parentId: input.parentId,
      status: 'ready',
      ...(input.description ? { description: input.description } : {}),
      ...(input.keywords?.length ? { keywords: input.keywords } : {}),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    // Read back for the server timestamps.
    return (await getDoc(ref)).data() as FolderRecord;
  }

  async update(folderId: string, patch: FolderPatch): Promise<void> {
    await updateDoc(doc(this.folders, folderId), { ...patch, updatedAt: serverTimestamp() });
  }

  async delete(folderId: string): Promise<void> {
    await deleteDoc(doc(this.folders, folderId));
  }
}
