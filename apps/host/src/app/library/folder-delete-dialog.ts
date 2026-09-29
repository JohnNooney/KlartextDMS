import { Component, computed, input, output } from '@angular/core';

/**
 * Recursive Folder delete confirmation (issue #33): spells out the deep
 * counts — "Contains 7 documents in 3 folders — all permanently deleted".
 */
@Component({
  selector: 'app-folder-delete-dialog',
  templateUrl: './folder-delete-dialog.html',
  styleUrl: './dialogs.scss',
  host: {
    '(document:keydown.escape)': 'closed.emit()',
  },
})
export class FolderDeleteDialog {
  readonly name = input.required<string>();
  readonly documentCount = input(0);
  readonly folderCount = input(0);
  readonly confirmed = output<void>();
  readonly closed = output<void>();

  protected readonly contents = computed(() => {
    const docs = this.documentCount();
    const folders = this.folderCount();
    if (docs === 0 && folders === 0) return 'This folder is empty.';
    const documents = `${docs} ${docs === 1 ? 'document' : 'documents'}`;
    const subfolders = `${folders} ${folders === 1 ? 'folder' : 'folders'}`;
    return `Contains ${documents} in ${subfolders} — all permanently deleted`;
  });
}
