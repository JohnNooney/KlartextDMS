import { Component, input, output } from '@angular/core';
import type { DocumentRecord } from '../data/document';
import { DialogViewport } from './dialog-viewport';

/**
 * Delete confirmation (issue #16): "Delete {title}? This permanently removes
 * the PDF and its plain-English summary."
 */
@Component({
  selector: 'app-delete-dialog',
  templateUrl: './delete-dialog.html',
  styleUrl: './dialogs.scss',
  imports: [DialogViewport],
  host: {
    '(document:keydown.escape)': 'closed.emit()',
  },
})
export class DeleteDialog {
  readonly doc = input.required<DocumentRecord>();
  readonly confirmed = output<void>();
  readonly closed = output<void>();
}
