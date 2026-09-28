/**
 * Host-only Folder persistence (issue #29, ADR 0005). Read-only: the reader's
 * path menu and back label need names and parents, and the whole collection
 * stays small enough for a single live feed. The Folders issue (#33) adds
 * create/move/delete to this interface.
 */
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  type CollectionReference,
  type Firestore,
} from 'firebase/firestore';
import type { FolderRecord } from './folder';

export interface FolderRepository {
  /**
   * The live Folder feed: invokes `listener` with the full list on every
   * Firestore snapshot. Returns the unsubscribe function.
   */
  watch(listener: (folders: FolderRecord[]) => void): () => void;
}

export class FirestoreFolderRepository implements FolderRepository {
  constructor(
    private readonly firestore: Firestore,
    private readonly ownerId: string,
  ) {}

  private get folders(): CollectionReference {
    return collection(this.firestore, 'users', this.ownerId, 'folders');
  }

  watch(listener: (folders: FolderRecord[]) => void): () => void {
    return onSnapshot(query(this.folders, orderBy('createdAt')), (snap) =>
      listener(snap.docs.map((d) => d.data() as FolderRecord)),
    );
  }
}
