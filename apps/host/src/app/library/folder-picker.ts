import { Component, computed, input, output } from '@angular/core';
import type { FolderNode, FolderTree } from '../data/folder-tree';

interface PickerRow {
  id: string | null;
  name: string;
  depth: number;
  disabled: boolean;
}

/**
 * The tree picker (issue #33) shared by **Move to…** and the upload dialog's
 * destination: the whole Folder tree, always expanded, with "Documents" as
 * the root. `disabledIds` greys out targets a move must reject (the Folder
 * itself and its descendants).
 */
@Component({
  selector: 'app-folder-picker',
  templateUrl: './folder-picker.html',
  styleUrl: './folder-picker.scss',
})
export class FolderPicker {
  readonly tree = input.required<FolderTree>();
  /** The selected Folder id — `null` is root. */
  readonly value = input<string | null>(null);
  readonly disabledIds = input<ReadonlySet<string>>(new Set());
  readonly valueChange = output<string | null>();

  protected readonly rows = computed<PickerRow[]>(() => {
    const disabled = this.disabledIds();
    const rows: PickerRow[] = [{ id: null, name: 'Documents', depth: 0, disabled: false }];
    const walk = (nodes: FolderNode[], depth: number, blocked: boolean): void => {
      for (const node of nodes) {
        const isBlocked = blocked || disabled.has(node.folder.id);
        rows.push({
          id: node.folder.id,
          name: node.folder.name,
          depth,
          disabled: isBlocked || node.folder.status === 'deleting',
        });
        walk(node.folders, depth + 1, isBlocked);
      }
    };
    walk(this.tree().folders, 1, false);
    return rows;
  });
}
