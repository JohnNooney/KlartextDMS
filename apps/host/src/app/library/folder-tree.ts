import { Component, computed, effect, input, output, signal } from '@angular/core';
import type { FolderNode, FolderTree } from '../data/folder-tree';
import { isItemDrag, readDragItem, setDragItem, type DragItem } from './folder-drag';

interface TreeRow {
  kind: 'root' | 'folder' | 'document';
  id: string | null;
  name: string;
  depth: number;
  count: number | null;
  expandable: boolean;
  expanded: boolean;
  deleting: boolean;
}

/**
 * The sidebar Folder tree (issue #33, ADR 0005): nested Folders first, then
 * Documents, each name-sorted, with deep-count badges over non-`deleting`
 * Documents. Folder rows and the "Documents" root are drop targets; Folder
 * and Document rows are drag sources.
 */
@Component({
  selector: 'app-folder-tree',
  templateUrl: './folder-tree.html',
  styleUrl: './folder-tree.scss',
})
export class FolderTreeView {
  readonly tree = input.required<FolderTree>();
  /** The browsed Folder (`null` = root) — highlighted and revealed. */
  readonly selectedFolderId = input<string | null>(null);
  readonly openDocId = input<string | null>(null);

  readonly folderOpened = output<string | null>();
  readonly documentOpened = output<string>();
  readonly itemDropped = output<{ item: DragItem; targetId: string | null }>();
  readonly newFolder = output<void>();

  private readonly expanded = signal<ReadonlySet<string>>(new Set());
  protected readonly dropTarget = signal<string | null | undefined>(undefined);

  constructor() {
    // Reveal the browsed Folder: expand its ancestors whenever it changes.
    effect(() => {
      const path = this.pathTo(this.tree().folders, this.selectedFolderId());
      if (path.length > 0) this.expanded.update((set) => new Set([...set, ...path]));
    });
  }

  protected readonly rows = computed<TreeRow[]>(() => {
    const tree = this.tree();
    const expanded = this.expanded();
    const rows: TreeRow[] = [
      {
        kind: 'root',
        id: null,
        name: 'Documents',
        depth: 0,
        count: null,
        expandable: false,
        expanded: true,
        deleting: false,
      },
    ];
    const walkDocs = (docs: FolderNode['documents'], depth: number) => {
      for (const doc of docs) {
        rows.push({
          kind: 'document',
          id: doc.id,
          name: doc.title,
          depth,
          count: null,
          expandable: false,
          expanded: false,
          deleting: doc.status === 'deleting',
        });
      }
    };
    const walk = (nodes: FolderNode[], depth: number) => {
      for (const node of nodes) {
        const isOpen = expanded.has(node.folder.id);
        rows.push({
          kind: 'folder',
          id: node.folder.id,
          name: node.folder.name,
          depth,
          count: node.deepDocumentCount,
          expandable: node.folders.length + node.documents.length > 0,
          expanded: isOpen,
          deleting: node.folder.status === 'deleting',
        });
        if (isOpen) {
          walk(node.folders, depth + 1);
          walkDocs(node.documents, depth + 1);
        }
      }
    };
    walk(tree.folders, 1);
    walkDocs(tree.documents, 1);
    return rows;
  });

  protected isSelected(row: TreeRow): boolean {
    if (row.kind === 'document') return row.id === this.openDocId();
    return row.id === this.selectedFolderId() && this.openDocId() === null;
  }

  protected toggle(row: TreeRow, event: Event): void {
    event.stopPropagation();
    if (row.id === null) return;
    this.expanded.update((set) => {
      const next = new Set(set);
      if (!next.delete(row.id!)) next.add(row.id!);
      return next;
    });
  }

  protected activate(row: TreeRow): void {
    if (row.deleting) return;
    if (row.kind === 'document') this.documentOpened.emit(row.id!);
    else this.folderOpened.emit(row.id);
  }

  protected onDragStart(row: TreeRow, event: DragEvent): void {
    if (row.kind === 'root' || row.deleting) return;
    setDragItem(event, { kind: row.kind, id: row.id! });
  }

  protected onDragOver(row: TreeRow, event: DragEvent): void {
    if (row.kind === 'document' || row.deleting || !isItemDrag(event)) return;
    event.preventDefault();
    this.dropTarget.set(row.id);
  }

  protected onDrop(row: TreeRow, event: DragEvent): void {
    this.dropTarget.set(undefined);
    if (row.kind === 'document' || row.deleting) return;
    const item = readDragItem(event);
    if (!item) return;
    event.preventDefault();
    this.itemDropped.emit({ item, targetId: row.id });
  }

  private pathTo(nodes: FolderNode[], folderId: string | null): string[] {
    if (folderId === null) return [];
    for (const node of nodes) {
      if (node.folder.id === folderId) return [node.folder.id];
      const below = this.pathTo(node.folders, folderId);
      if (below.length > 0) return [node.folder.id, ...below];
    }
    return [];
  }
}
