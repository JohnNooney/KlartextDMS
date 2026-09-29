import { Component, computed, inject, signal } from '@angular/core';
import { ExtractionFlow } from '../bus/extraction-flow';
import { provideDocumentData } from '../data/providers';
import type { DocumentRecord } from '../data/document';
import type { FolderRecord } from '../data/folder';
import { OpenDocument } from '../open-document';
import { Reader } from '../reader/reader';
import { DeleteDialog } from './delete-dialog';
import { DocumentTile, type TileAction } from './document-tile';
import { FolderDeleteDialog } from './folder-delete-dialog';
import { isItemDrag, type DragItem } from './folder-drag';
import { FolderNameDialog, type FolderNameResult } from './folder-name-dialog';
import { FolderTile, type FolderTileAction } from './folder-tile';
import { FolderTreeView } from './folder-tree';
import { MoveDialog } from './move-dialog';
import { RenameDialog } from './rename-dialog';
import { UploadDialog } from './upload-dialog';
import { LibraryStore } from './library.store';

type DialogState =
  | { kind: 'upload' }
  | { kind: 'rename'; doc: DocumentRecord }
  | { kind: 'move'; doc: DocumentRecord }
  | { kind: 'delete'; doc: DocumentRecord }
  | { kind: 'new-folder' }
  | { kind: 'rename-folder'; folder: FolderRecord }
  | { kind: 'move-folder'; folder: FolderRecord }
  | { kind: 'delete-folder'; folder: FolderRecord }
  | null;

/**
 * The Files-style Document library (issues #28, #29): tile grid + toolbar over
 * the live Firestore feed, drop-to-upload on the grid, the per-state ⋮ menus,
 * the dialogs, and (issue #33) the sidebar Folder tree, Folder tiles and
 * drag-to-file. The URL's Folder filters the grid.
 *
 * While a Document is open, this renders the `app-reader` split view: the
 * pdf.js viewer left, the Guest insights panel right (ADR 0002).
 */
@Component({
  selector: 'app-library',
  templateUrl: './library.html',
  styleUrl: './library.scss',
  imports: [
    DocumentTile,
    FolderTile,
    FolderTreeView,
    Reader,
    UploadDialog,
    RenameDialog,
    MoveDialog,
    DeleteDialog,
    FolderNameDialog,
    FolderDeleteDialog,
  ],
  // The data layer is scoped to the signed-in session: this component only
  // exists inside the auth gate's signed-in branch.
  providers: [...provideDocumentData(), ExtractionFlow],
})
export class Library {
  protected readonly store = inject(LibraryStore);
  protected readonly dialog = signal<DialogState>(null);
  // Instantiating starts Session flow + Extraction Job orchestration for
  // the signed-in session (issue #31); it self-attaches to the Bus, and the
  // tile's ⋮ Retry analysis routes through it (issue #32).
  protected readonly flow = inject(ExtractionFlow);

  protected readonly dropHover = signal(false);
  protected readonly openDocument = inject(OpenDocument);
  protected readonly title = computed(
    () => this.store.folderById(this.openDocument.folderId())?.name ?? 'Documents',
  );

  /**
   * Inside a Folder, the ‹ affordance's target — the Folder's own parent
   * (issue #55). `undefined` at root — or while the Folder's record hasn't
   * resolved — where the affordance doesn't show; `null` = the way up is
   * Documents. The sidebar tree that desktop navigates with is hidden on
   * mobile, so this is the way back up a level.
   */
  protected readonly backTarget = computed<string | null | undefined>(() => {
    const folderId = this.openDocument.folderId();
    if (folderId === null) return undefined;
    return this.store.folderById(folderId)?.parentId;
  });

  /** The ‹ affordance's label — the parent Folder's name, Documents at top level. */
  protected readonly backLabel = computed(() => {
    const target = this.backTarget();
    return target ? (this.store.folderById(target)?.name ?? 'Folder') : 'Documents';
  });

  protected back(): void {
    const target = this.backTarget();
    if (target !== undefined) this.openFolder(target);
  }

  protected openUpload(): void {
    this.dialog.set({ kind: 'upload' });
  }

  protected onPicked(picked: { files: File[]; folderId: string | null }): void {
    this.dialog.set(null);
    this.store.uploadFiles(picked.files, picked.folderId);
  }

  protected onFolderAction(folder: FolderRecord, action: FolderTileAction): void {
    switch (action) {
      case 'rename':
        this.dialog.set({ kind: 'rename-folder', folder });
        break;
      case 'move':
        this.dialog.set({ kind: 'move-folder', folder });
        break;
      case 'delete':
        this.dialog.set({ kind: 'delete-folder', folder });
        break;
      case 'retry-delete':
        void this.store.retryFolderDelete(folder.id);
        break;
    }
  }

  protected openFolder(folderId: string | null): void {
    this.openDocument.openFolder(folderId);
  }

  protected onItemDropped(item: DragItem, targetId: string | null): void {
    void this.store.dropItem(item, targetId);
  }

  protected newFolderTaken = (name: string): boolean =>
    this.store.nameTaken(this.openDocument.folderId(), name);

  protected renameTaken(folder: FolderRecord): (name: string) => boolean {
    return (name) => this.store.nameTaken(folder.parentId, name, folder.id);
  }

  protected onFolderNamed(result: FolderNameResult): void {
    const state = this.dialog();
    this.closeDialog();
    if (state?.kind === 'new-folder') void this.store.createFolder(result);
    else if (state?.kind === 'rename-folder') void this.store.renameFolder(state.folder.id, result.name);
  }

  protected onTileAction(doc: DocumentRecord, action: TileAction): void {
    switch (action) {
      case 'cancel-upload':
        this.store.cancelUpload(doc.id);
        break;
      case 'retry-upload':
        this.store.retryUpload(doc.id);
        break;
      case 'remove':
        void this.store.removeFailed(doc.id);
        break;
      case 'retry-delete':
        void this.store.retryDelete(doc.id);
        break;
      case 'rename':
        this.dialog.set({ kind: 'rename', doc });
        break;
      case 'move':
        this.dialog.set({ kind: 'move', doc });
        break;
      case 'download':
        void this.store.download(doc.id);
        break;
      case 'retry-extraction':
        this.flow.retryRequested(doc.id);
        break;
      case 'delete':
        this.dialog.set({ kind: 'delete', doc });
        break;
    }
  }

  /** Drop-to-retry: the first dropped file retries under the same documentId. */
  protected onTileDropped(doc: DocumentRecord, files: File[]): void {
    if (files[0]) this.store.retryWithFile(doc.id, files[0]);
  }

  /** Files dropped on the grid upload into the current Folder (root, #28). */
  protected onGridDrop(event: DragEvent): void {
    event.preventDefault();
    this.dropHover.set(false);
    if (!event.dataTransfer?.files.length) return;
    this.store.uploadFiles(event.dataTransfer?.files ?? []);
  }

  protected onGridDragOver(event: DragEvent): void {
    // In-app item drags (Folder/Document tiles) aren't uploads.
    if (isItemDrag(event)) return;
    event.preventDefault();
    this.dropHover.set(true);
  }

  protected onGridDragLeave(event: DragEvent): void {
    const grid = event.currentTarget as HTMLElement;
    if (!grid.contains(event.relatedTarget as Node | null)) this.dropHover.set(false);
  }

  protected closeDialog(): void {
    this.dialog.set(null);
  }
}
