import { Component, input, output } from '@angular/core';
import type { DocumentRecord } from '../data/document';

/**
 * ⋮ → Move to… (issue #16). The flat library ships with a placeholder
 * destination control — root only — that the Folder-tree picker replaces
 * with the Folders issue (#33).
 */
@Component({
  selector: 'app-move-dialog',
  templateUrl: './move-dialog.html',
  styleUrl: './dialogs.scss',
  host: {
    '(document:keydown.escape)': 'closed.emit()',
  },
})
export class MoveDialog {
  readonly doc = input.required<DocumentRecord>();
  /** The chosen Folder id — `null` is root ("Documents"). */
  readonly moved = output<string | null>();
  readonly closed = output<void>();
}
