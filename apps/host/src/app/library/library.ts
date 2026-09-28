import { Component, inject, signal } from '@angular/core';
import { provideDocumentData } from '../data/providers';
import type { DocumentRecord } from '../data/document';
import { DeleteDialog } from './delete-dialog';
import { DocumentTile, type TileAction } from './document-tile';
import { MoveDialog } from './move-dialog';
import { RenameDialog } from './rename-dialog';
import { UploadDialog } from './upload-dialog';
import { LibraryStore } from './library.store';

type DialogState =
  | { kind: 'upload' }
  | { kind: 'rename'; doc: DocumentRecord }
  | { kind: 'move'; doc: DocumentRecord }
  | { kind: 'delete'; doc: DocumentRecord }
  | null;

/**
 * The Files-style Document library (issue #28): tile grid + toolbar over the
 * live Firestore feed, drop-to-upload on the grid, the per-state ⋮ menus, and
 * the four dialogs. Ships flat — the Folder tree and tree pickers land with
 * the Folders issue (#33).
 *
 * While a Document is open, this renders the reader shell: the pdf.js viewer
 * lands in the pane with the open-Document issue (#29); the insights slot is
 * where the Guest iframe displays.
 */
@Component({
  selector: 'app-library',
  templateUrl: './library.html',
  styleUrl: './library.scss',
  imports: [DocumentTile, UploadDialog, RenameDialog, MoveDialog, DeleteDialog],
  // The data layer is scoped to the signed-in session: this component only
  // exists inside the auth gate's signed-in branch.
  providers: provideDocumentData(),
})
export class Library {
  protected readonly store = inject(LibraryStore);
  protected readonly dialog = signal<DialogState>(null);
  protected readonly dropHover = signal(false);

  protected openUpload(): void {
    this.dialog.set({ kind: 'upload' });
  }

  protected onPicked(files: File[]): void {
    this.dialog.set(null);
    this.store.uploadFiles(files);
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
    this.store.uploadFiles(event.dataTransfer?.files ?? []);
  }

  protected onGridDragOver(event: DragEvent): void {
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
