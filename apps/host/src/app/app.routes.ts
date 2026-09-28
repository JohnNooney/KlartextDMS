import { Routes, UrlSegment, type UrlMatchResult } from '@angular/router';

/** The URL segment standing in for the root Folder ("Documents"). */
export const ROOT_FOLDER_SEGMENT = 'root';

export function folderSegment(folderId: string | null): string {
  return folderId ?? ROOT_FOLDER_SEGMENT;
}

export function parseFolderSegment(segment: string | null): string | null {
  return segment === null || segment === ROOT_FOLDER_SEGMENT ? null : segment;
}

/**
 * The library's URL space (issue #29): `/folder/<fid>` browses a Folder and
 * `/folder/<fid>/doc/<id>` reads a Document; `root` names the root Folder.
 * One matcher serves both shapes so the Library component — and the live
 * document/folder feeds behind it — survives open/close navigation.
 */
export function libraryUrl(segments: UrlSegment[]): UrlMatchResult | null {
  if (segments.length === 2 && segments[0]!.path === 'folder') {
    return { consumed: segments, posParams: { folderId: segments[1]! } };
  }
  if (
    segments.length === 4 &&
    segments[0]!.path === 'folder' &&
    segments[2]!.path === 'doc'
  ) {
    return {
      consumed: segments,
      posParams: { folderId: segments[1]!, docId: segments[3]! },
    };
  }
  return null;
}

// `loadComponent` keeps the data layer out of this file's import graph —
// a static edge here completes the providers ↔ library import cycle.
export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'folder/root' },
  { matcher: libraryUrl, loadComponent: () => import('./library/library').then((m) => m.Library) },
  { path: '**', redirectTo: 'folder/root' },
];
