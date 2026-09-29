import { Component, computed, input, output, signal } from '@angular/core';
import type { FolderRecord } from '../data/folder';
import { isItemDrag, readDragItem, setDragItem, type DragItem } from './folder-drag';

export type FolderTileAction = 'rename' | 'move' | 'delete' | 'retry-delete';

interface MenuItem {
  action: FolderTileAction;
  label: string;
  destructive?: boolean;
  /** Renders a separator above the item. */
  separated?: boolean;
}

/**
 * One Folder tile in the library grid (issue #33, ADR 0005): the Document
 * tile's ⋮ contract — Rename, Move to…, divider, Delete — plus drag-source
 * and drop-target behaviour for filing by drag. A `deleting` Folder shows a
 * spinner and, after a failed teardown, **Retry delete**.
 */
@Component({
  selector: 'app-folder-tile',
  templateUrl: './folder-tile.html',
  styleUrl: './document-tile.scss',
  host: {
    class: 'tile',
    '[class.has-menu]': 'menuOpen()',
    '[class.is-openable]': 'openable()',
    '[class.is-drop-target]': 'dropHover()',
    '[attr.role]': "openable() ? 'button' : null",
    '[attr.tabindex]': 'openable() ? 0 : null',
    '[attr.draggable]': "openable() ? 'true' : null",
    '(click)': 'onTileClick()',
    '(keydown.enter)': 'onTileClick()',
    '(dragstart)': 'onDragStart($event)',
    '(dragover)': 'onDragOver($event)',
    '(dragleave)': 'dropHover.set(false)',
    '(drop)': 'onDrop($event)',
    '(document:keydown.escape)': 'menuOpen.set(false)',
  },
})
export class FolderTile {
  readonly folder = input.required<FolderRecord>();
  /** Documents at any depth below, excluding `deleting` ones. */
  readonly documentCount = input(0);
  readonly folderCount = input(0);
  /** A delete failed, leaving `deleting` — ⋮ offers **Retry delete**. */
  readonly deleteFailed = input(false);

  readonly opened = output<void>();
  readonly action = output<FolderTileAction>();
  /** A Folder or Document dragged onto this tile. */
  readonly itemDropped = output<DragItem>();

  protected readonly menuOpen = signal(false);
  protected readonly dropHover = signal(false);

  protected readonly openable = computed(() => this.folder().status === 'ready');
  protected readonly menuItems = computed<MenuItem[]>(() => {
    if (this.folder().status === 'deleting') {
      return this.deleteFailed()
        ? [{ action: 'retry-delete', label: 'Retry delete', destructive: true }]
        : [];
    }
    return [
      { action: 'rename', label: 'Rename' },
      { action: 'move', label: 'Move to…' },
      { action: 'delete', label: 'Delete', destructive: true, separated: true },
    ];
  });
  protected readonly summary = computed(() => {
    const docs = this.documentCount();
    return `${docs} ${docs === 1 ? 'document' : 'documents'}`;
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

  protected onDragStart(event: DragEvent): void {
    if (this.openable()) setDragItem(event, { kind: 'folder', id: this.folder().id });
  }

  protected onDragOver(event: DragEvent): void {
    if (!this.openable() || !isItemDrag(event)) return;
    event.preventDefault();
    this.dropHover.set(true);
  }

  protected onDrop(event: DragEvent): void {
    this.dropHover.set(false);
    const item = this.openable() && isItemDrag(event) ? readDragItem(event) : null;
    if (!item) return;
    event.preventDefault();
    event.stopPropagation();
    this.itemDropped.emit(item);
  }
}
