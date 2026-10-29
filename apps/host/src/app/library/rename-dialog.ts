import { Component, computed, input, output, signal } from '@angular/core';
import type { DocumentRecord } from '../data/document';
import { DiscardChangesAlert } from './discard-changes-alert';
import { ModalSurface } from './modal-surface';

/**
 * Rename dialog (issue #16): current `title` pre-filled; the only rule is
 * non-empty after trim — duplicates are allowed. Edits `title` only;
 * `originalFilename` stays immutable provenance. A dirty draft asks
 * "Discard changes?" before an implicit close (issue #151).
 */
@Component({
  selector: 'app-rename-dialog',
  templateUrl: './rename-dialog.html',
  styleUrl: './dialogs.scss',
  imports: [DiscardChangesAlert, ModalSurface],
})
export class RenameDialog {
  readonly doc = input.required<DocumentRecord>();
  readonly saved = output<string>();
  readonly closed = output<void>();

  /** `null` = untouched; the field still shows the current title. */
  private readonly draft = signal<string | null>(null);
  protected readonly value = computed(() => this.draft() ?? this.doc().title);
  protected readonly canSave = computed(() => this.value().trim().length > 0);

  /** Unsaved input — the field differs from what the dialog opened with. */
  readonly dirty = computed(() => this.value() !== this.doc().title);
  protected readonly confirmingDiscard = signal(false);

  /** An implicit close of a dirty dialog asks first; a clean one closes. */
  protected onCloseRequested(): void {
    if (this.dirty()) this.confirmingDiscard.set(true);
    else this.closed.emit();
  }

  protected onInput(event: Event): void {
    this.draft.set((event.target as HTMLInputElement).value);
  }

  protected submit(event: Event): void {
    event.preventDefault();
    const title = this.value().trim();
    if (title) this.saved.emit(title);
  }
}
