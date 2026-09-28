import { Component, computed, input, output, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import type { DocumentRecord } from '../data/document';

/** The ⋮ menu verbs a tile can emit; the library maps them to store calls. */
export type TileAction =
  | 'cancel-upload'
  | 'retry-upload'
  | 'remove'
  | 'retry-delete'
  | 'rename'
  | 'move'
  | 'download'
  | 'delete';

interface MenuItem {
  action: TileAction;
  label: string;
  destructive?: boolean;
  /** Renders a separator above the item. */
  separated?: boolean;
}

/**
 * One Document tile in the library grid (issues #16, #28): the per-state
 * contract — `uploading` shows a progress bar, `failed` a warning chip and is
 * the drop-to-retry target, `deleting` a spinner (Retry delete after a failed
 * teardown), `ready` the normal openable tile with the extraction chip slot
 * the lifecycle issue (#32) populates.
 */
@Component({
  selector: 'app-document-tile',
  templateUrl: './document-tile.html',
  styleUrl: './document-tile.scss',
  imports: [DatePipe],
  host: {
    class: 'tile',
    '[class.has-menu]': 'menuOpen()',
    '[class.is-openable]': 'openable()',
    '[class.is-drop-target]': 'dropHover()',
    '[attr.role]': "openable() ? 'button' : null",
    '[attr.tabindex]': 'openable() ? 0 : null',
    '(click)': 'onTileClick()',
    '(keydown.enter)': 'onTileClick()',
    '(dragover)': 'onDragOver($event)',
    '(dragleave)': 'onDragLeave()',
    '(drop)': 'onDrop($event)',
    '(document:keydown.escape)': 'closeMenu()',
  },
})
export class DocumentTile {
  readonly doc = input.required<DocumentRecord>();
  /** 0–1 while an upload task is in flight; `null` otherwise. */
  readonly progress = input<number | null>(null);
  /** The session holds the `File` — ⋮ may offer **Retry upload**. */
  readonly canRetry = input(false);
  /** A delete failed, leaving `deleting` — ⋮ offers **Retry delete**. */
  readonly deleteFailed = input(false);

  readonly opened = output<void>();
  readonly action = output<TileAction>();
  /** Files dropped on a `failed` tile — drop-to-retry (issue #16). */
  readonly dropped = output<File[]>();

  protected readonly menuOpen = signal(false);
  protected readonly dropHover = signal(false);

  protected readonly openable = computed(() => this.doc().status === 'ready');
  protected readonly progressPct = computed(() =>
    Math.round((this.progress() ?? 0) * 100),
  );
  protected readonly createdLabel = computed(
    () => new Date(this.doc().createdAt.seconds * 1000),
  );

  /** The decided ⋮ menu for the tile's current status (issue #16). */
  protected readonly menuItems = computed<MenuItem[]>(() => {
    switch (this.doc().status) {
      case 'uploading':
        return [{ action: 'cancel-upload', label: 'Cancel upload' }];
      case 'ready':
        return [
          { action: 'rename', label: 'Rename' },
          { action: 'move', label: 'Move to…' },
          { action: 'download', label: 'Download' },
          { action: 'delete', label: 'Delete', destructive: true, separated: true },
        ];
      case 'failed':
        // Spec: Retry upload while the session holds the File, else Remove.
        return this.canRetry()
          ? [{ action: 'retry-upload', label: 'Retry upload' }]
          : [{ action: 'remove', label: 'Remove', destructive: true }];
      case 'deleting':
        return this.deleteFailed()
          ? [{ action: 'retry-delete', label: 'Retry delete', destructive: true }]
          : [];
    }
  });

  protected onTileClick(): void {
    if (this.openable() && !this.menuOpen()) this.opened.emit();
  }

  protected toggleMenu(event: Event): void {
    event.stopPropagation();
    this.menuOpen.update((open) => !open);
  }

  protected pick(item: MenuItem, event: Event): void {
    event.stopPropagation();
    this.menuOpen.set(false);
    this.action.emit(item.action);
  }

  protected closeMenu(): void {
    this.menuOpen.set(false);
  }

  /** Only `failed` tiles accept drops — everything else falls through to the grid. */
  protected onDragOver(event: Event): void {
    if (this.doc().status !== 'failed') return;
    event.preventDefault();
    this.dropHover.set(true);
  }

  protected onDragLeave(): void {
    this.dropHover.set(false);
  }

  protected onDrop(event: DragEvent): void {
    if (this.doc().status !== 'failed') return;
    event.preventDefault();
    event.stopPropagation();
    this.dropHover.set(false);
    this.dropped.emit([...(event.dataTransfer?.files ?? [])]);
  }
}
