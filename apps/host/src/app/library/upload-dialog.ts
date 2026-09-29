import { Component, input, output, signal } from '@angular/core';
import type { FolderTree } from '../data/folder-tree';
import { FolderPicker } from './folder-picker';

/**
 * The upload dialog (issues #16, #28): browse + drag-and-drop with a
 * destination tree picker (#33). It closes
 * the moment files are selected — progress lives on the tiles, not here.
 */
@Component({
  selector: 'app-upload-dialog',
  templateUrl: './upload-dialog.html',
  imports: [FolderPicker],
  styleUrl: './dialogs.scss',
  host: {
    '(document:keydown.escape)': 'closed.emit()',
  },
})
export class UploadDialog {
  readonly tree = input.required<FolderTree>();
  /** The Folder the dialog opens on — the one being browsed. */
  readonly initialFolderId = input<string | null>(null);
  /** Files selected or dropped, with their destination — the dialog closes on selection (#16). */
  readonly picked = output<{ files: File[]; folderId: string | null }>();
  readonly closed = output<void>();

  protected readonly dropHover = signal(false);
  private readonly destination = signal<string | null | undefined>(undefined);
  protected readonly folderId = () => {
    const chosen = this.destination();
    return chosen === undefined ? this.initialFolderId() : chosen;
  };

  protected choose(folderId: string | null): void {
    this.destination.set(folderId);
  }

  protected onFiles(files: Iterable<File> | null): void {
    const list = [...(files ?? [])];
    if (list.length > 0) this.picked.emit({ files: list, folderId: this.folderId() });
  }

  protected onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dropHover.set(true);
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dropHover.set(false);
    this.onFiles(event.dataTransfer?.files ?? null);
  }
}
