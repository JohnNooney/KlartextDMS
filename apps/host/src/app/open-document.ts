import { inject, Injectable, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationCancel, NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { folderSegment, parseFolderSegment } from './app.routes';
import type { DocumentRecord } from './data/document';

/**
 * Which Document is open for reading and which Folder the library browses
 * (issues #28, #29). The URL is the source of truth — `/folder/<fid>` browses
 * and `/folder/<fid>/doc/<id>` reads — so deep links and browser back/forward
 * land on the same seam as in-app navigation. Kept app-global so the library,
 * the reader, and the Guest iframe's visibility all agree: the frame stays
 * mounted hidden for background Extraction Jobs and only displays while a
 * Document is open (issue #16).
 */
@Injectable({ providedIn: 'root' })
export class OpenDocument {
  private readonly router = inject(Router);

  /** The open Document's id, or `null` while browsing the library. */
  readonly docId = signal<string | null>(null);
  /** The Folder being browsed (`null` = root, "Documents"). */
  readonly folderId = signal<string | null>(null);

  constructor() {
    this.router.events
      .pipe(
        filter(
          (event): event is NavigationEnd | NavigationCancel =>
            event instanceof NavigationEnd || event instanceof NavigationCancel,
        ),
        takeUntilDestroyed(),
      )
      // NavigationCancel heals a cancelled navigation's optimistic writes.
      .subscribe(() => this.readRoute());
    // A service that first resolves after the initial navigation still sees
    // the URL it booted under.
    this.readRoute();
  }

  /** Opens a Document for reading — writes Folder + Document into the URL. */
  open(document: Pick<DocumentRecord, 'id' | 'folderId'>): void {
    this.folderId.set(document.folderId);
    this.docId.set(document.id);
    void this.router.navigate([
      '/folder',
      folderSegment(document.folderId),
      'doc',
      document.id,
    ]);
  }

  /** Browses a Folder (`null` = root) — the path menu's target (#29). */
  openFolder(folderId: string | null): void {
    this.folderId.set(folderId);
    this.docId.set(null);
    void this.router.navigate(browseCommands(folderId));
  }

  /**
   * Back out of the open Document to a Folder — the Document's own Folder by
   * the `‹` label's contract, the URL's Folder by default (#29).
   */
  close(folderId: string | null = this.folderId()): void {
    this.docId.set(null);
    this.folderId.set(folderId);
    void this.router.navigate(browseCommands(folderId));
  }

  private readRoute(): void {
    let route = this.router.routerState.snapshot.root;
    let folderId: string | null = null;
    let docId: string | null = null;
    while (route.firstChild) {
      route = route.firstChild;
      folderId = parseFolderSegment(route.paramMap.get('folderId')) ?? folderId;
      docId = route.paramMap.get('docId') ?? docId;
    }
    this.folderId.set(folderId);
    this.docId.set(docId);
  }
}

function browseCommands(folderId: string | null): string[] {
  return folderId === null ? ['/'] : ['/folder', folderId];
}
