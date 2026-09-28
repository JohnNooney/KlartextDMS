import { Component, computed, input, output, signal } from '@angular/core';
import type { DocumentRecord } from '../data/document';

/**
 * Rename dialog (issue #16): current `title` pre-filled; the only rule is
 * non-empty after trim — duplicates are allowed. Edits `title` only;
 * `originalFilename` stays immutable provenance.
 */
@Component({
  selector: 'app-rename-dialog',
  templateUrl: './rename-dialog.html',
  styleUrl: './dialogs.scss',
  host: {
    '(document:keydown.escape)': 'closed.emit()',
  },
})
export class RenameDialog {
  readonly doc = input.required<DocumentRecord>();
  readonly saved = output<string>();
  readonly closed = output<void>();

  /** `null` = untouched; the field still shows the current title. */
  private readonly draft = signal<string | null>(null);
  protected readonly value = computed(() => this.draft() ?? this.doc().title);
  protected readonly canSave = computed(() => this.value().trim().length > 0);

  protected onInput(event: Event): void {
    this.draft.set((event.target as HTMLInputElement).value);
  }

  protected submit(event: Event): void {
    event.preventDefault();
    const title = this.value().trim();
    if (title) this.saved.emit(title);
  }
}
