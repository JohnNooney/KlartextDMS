import { inject, Injectable, signal } from '@angular/core';
import type { IdentifiedActionItem } from '@klartext/bus-contract';
import type { DocumentRecord } from '../data/document';
import { LibraryStore } from '../library/library.store';
import { ToastService } from '../toasts/toast.service';

/** What the Reminder dialog composes: the Action Item and its Document. */
export interface ReminderDraft {
  doc: DocumentRecord;
  item: IdentifiedActionItem;
  /** The Host's own origin — the deep link's base, resolved once at open. */
  origin: string;
}

/**
 * The Reminder flow's state seam (issue #122): every entry point — the
 * Guest's `GUEST_CREATE_REMINDER` and the Folder attention overview's own
 * rows — resolves its Action Item here and lands on the one dialog. The
 * Host resolves items from the Extraction index (ADR 0011); Klartext never
 * tracks a Reminder once exported.
 */
@Injectable()
export class Reminders {
  private readonly store = inject(LibraryStore);
  private readonly toasts = inject(ToastService);

  /** The draft the Reminder dialog renders; `null` closes it. */
  readonly draft = signal<ReminderDraft | null>(null);

  /**
   * Opens the dialog for one Action Item — `documentId` plus the item's
   * stable id. A Document or item that has since vanished reports a toast
   * rather than opening an empty dialog.
   */
  open(documentId: string, actionItemId: string): void {
    const doc = this.store
      .documents()
      ?.find((d) => d.id === documentId && d.status === 'ready');
    const item = this.store
      .extractionsByDocId()
      .get(documentId)
      ?.actionItems.find((i) => i.id === actionItemId);
    if (!doc || !item) {
      this.toasts.show({
        tone: 'error',
        title: "Couldn't create the reminder",
        body: 'That action item is no longer available.',
      });
      return;
    }
    this.draft.set({ doc, item, origin: location.origin });
  }

  close(): void {
    this.draft.set(null);
  }
}
