import { Component, output, signal } from '@angular/core';

/**
 * The upload dialog (issues #16, #28): browse + drag-and-drop with a
 * destination placeholder the Folder-tree picker replaces (#33). It closes
 * the moment files are selected — progress lives on the tiles, not here.
 */
@Component({
  selector: 'app-upload-dialog',
  templateUrl: './upload-dialog.html',
  styleUrl: './dialogs.scss',
  host: {
    '(document:keydown.escape)': 'closed.emit()',
  },
})
export class UploadDialog {
  /** Files selected or dropped — the dialog closes on selection (#16). */
  readonly picked = output<File[]>();
  readonly closed = output<void>();

  protected readonly dropHover = signal(false);

  protected onFiles(files: Iterable<File> | null): void {
    const list = [...(files ?? [])];
    if (list.length > 0) this.picked.emit(list);
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
