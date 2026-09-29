import { Component, input, output, signal } from '@angular/core';
import type { FolderTree } from '../data/folder-tree';
import { DialogViewport } from './dialog-viewport';
import { FolderPicker } from './folder-picker';

/**
 * ⋮ → Move to… for a Document or Folder (issues #16, #33): the shared tree
 * picker. `disabledIds` carries a Folder's own subtree so cycles can't be
 * picked.
 */
@Component({
  selector: 'app-move-dialog',
  templateUrl: './move-dialog.html',
  styleUrl: './dialogs.scss',
  imports: [FolderPicker, DialogViewport],
  host: {
    '(document:keydown.escape)': 'closed.emit()',
  },
})
export class MoveDialog {
  /** The moved item's display name. */
  readonly label = input.required<string>();
  readonly tree = input.required<FolderTree>();
  /** Where the item lives now — preselected. */
  readonly current = input<string | null>(null);
  readonly disabledIds = input<ReadonlySet<string>>(new Set());
  /** The chosen Folder id — `null` is root ("Documents"). */
  readonly moved = output<string | null>();
  readonly closed = output<void>();

  /** `undefined` = untouched; the picker shows `current`. */
  protected readonly choice = signal<string | null | undefined>(undefined);
}
