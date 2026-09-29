/**
 * Drag payload shared by the tiles and the sidebar tree (issue #33): a
 * Folder or Document dragged onto a Folder target. Only the id travels — the
 * store validates the move — and the custom MIME keeps file drops (upload)
 * distinct from in-app moves.
 */
export const DRAG_MIME = 'application/x-klartext-item';

export interface DragItem {
  kind: 'folder' | 'document';
  id: string;
}

export function setDragItem(event: DragEvent, item: DragItem): void {
  event.dataTransfer?.setData(DRAG_MIME, JSON.stringify(item));
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
}

/** Whether the drag in flight is an in-app item (readable data only on drop). */
export function isItemDrag(event: DragEvent): boolean {
  return [...(event.dataTransfer?.types ?? [])].includes(DRAG_MIME);
}

export function readDragItem(event: DragEvent): DragItem | null {
  const raw = event.dataTransfer?.getData(DRAG_MIME);
  if (!raw) return null;
  try {
    const item = JSON.parse(raw) as DragItem;
    return item.id && (item.kind === 'folder' || item.kind === 'document') ? item : null;
  } catch {
    return null;
  }
}
