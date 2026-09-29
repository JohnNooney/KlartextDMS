import { Component, computed, input, output, signal } from '@angular/core';

export interface FolderNameResult {
  name: string;
  description?: string;
  keywords?: string[];
}

/**
 * New-folder / Rename-folder dialog (issue #33). The name is required and
 * must be unique among siblings (`taken` decides, case-insensitively);
 * description and keywords are optional and only offered on create — they're
 * persisted with no v1 consumer.
 */
@Component({
  selector: 'app-folder-name-dialog',
  templateUrl: './folder-name-dialog.html',
  styleUrl: './dialogs.scss',
  host: {
    '(document:keydown.escape)': 'closed.emit()',
  },
})
export class FolderNameDialog {
  readonly heading = input('New folder');
  readonly initialName = input('');
  /** Offers the description + keywords fields (create only). */
  readonly withDetails = input(false);
  /** Whether a sibling already uses this name. */
  readonly taken = input<(name: string) => boolean>(() => false);
  readonly saved = output<FolderNameResult>();
  readonly closed = output<void>();

  private readonly nameDraft = signal<string | null>(null);
  private readonly description = signal('');
  private readonly keywords = signal('');

  protected readonly name = computed(() => this.nameDraft() ?? this.initialName());
  protected readonly duplicate = computed(() => {
    const trimmed = this.name().trim();
    return trimmed.length > 0 && this.taken()(trimmed);
  });
  protected readonly canSave = computed(() => this.name().trim().length > 0 && !this.duplicate());

  protected onName(event: Event): void {
    this.nameDraft.set((event.target as HTMLInputElement).value);
  }

  protected onDescription(event: Event): void {
    this.description.set((event.target as HTMLTextAreaElement).value);
  }

  protected onKeywords(event: Event): void {
    this.keywords.set((event.target as HTMLInputElement).value);
  }

  protected submit(event: Event): void {
    event.preventDefault();
    if (!this.canSave()) return;
    const description = this.description().trim();
    const keywords = this.keywords()
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean);
    this.saved.emit({
      name: this.name().trim(),
      ...(this.withDetails() && description ? { description } : {}),
      ...(this.withDetails() && keywords.length ? { keywords } : {}),
    });
  }
}
