import { inject, Injectable, linkedSignal, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationCancel, NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { folderSegment, parseFolderSegment, ROOT_FOLDER_SEGMENT } from './app.routes';
import type { DocumentRecord } from './data/document';

/** A `/doc/<id>` deep link awaiting Folder resolution (issue #122). */
export interface DocDeepLink {
  documentId: string;
  /** The cited page — `null` when the link carries none. */
  page: number | null;
  /** The Action Item's stable id — `null` when the link carries none. */
  item: string | null;
}

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
  /**
   * The library search query (issue #121) — the URL's `?q=`, so a deep link
   * searches immediately and browser back out of a result lands on the same
   * results. Browsing or reading drops it: only a `?q=` URL carries it.
   */
  readonly query = signal<string | null>(null);
  /**
   * The library search scope (issue #121) — the URL's `?scope=all` widens the
   * search from the browsed Folder's subtree to the whole library, so the
   * results a `?q=` round-trip lands on are the ones the user left.
   */
  readonly searchScope = signal<'folder' | 'all'>('folder');
  /**
   * Whether the Host hides the Guest's insights lane (issue #76) — a
   * Host-only concern, never a Bus message; the Guest frame stays mounted so
   * background Extraction Jobs keep running (ADR 0003). Linked to the open
   * Document: every opened Document starts with the lane shown.
   */
  readonly insightsLaneHidden = linkedSignal<string | null, boolean>({
    source: this.docId,
    computation: () => false,
  });
  /**
   * The `/doc/<id>` deep-link form (issue #122): set while the bare-doc URL
   * is live so the Library — which owns the Document feed — can resolve the
   * Folder and rewrite to the canonical URL. `null` on every other route.
   */
  readonly deepLink = signal<DocDeepLink | null>(null);

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

  /** Shows or hides the insights lane — the reader toolbar's toggle (#76). */
  toggleInsightsLane(): void {
    this.insightsLaneHidden.update((hidden) => !hidden);
  }

  /**
   * Lands a resolved `/doc/<id>` deep link on the canonical Folder URL
   * (issue #122): `?page&item` ride along so the link stays shareable, and
   * `replaceUrl` keeps browser back out of a redirect loop.
   */
  landDeepLink(document: Pick<DocumentRecord, 'id' | 'folderId'>, link: DocDeepLink): void {
    void this.router.navigate(
      ['/folder', folderSegment(document.folderId), 'doc', document.id],
      { queryParams: { page: link.page, item: link.item }, replaceUrl: true },
    );
  }

  /** A deep-linked Document that isn't there falls back to the root Folder. */
  deepLinkMissed(): void {
    void this.router.navigate(['/folder', ROOT_FOLDER_SEGMENT], { replaceUrl: true });
  }

  /**
   * Writes the library search query into the browsed Folder's URL (issue
   * #121). The first entry pushes a history entry (so back from an opened
   * result returns to the results); edits and clears replace it — typing must
   * not stack a history entry per keystroke. A no-op while a Document is open.
   */
  search(query: string): void {
    if (this.docId() !== null) return;
    const q = query.trim() || null;
    // An unchanged query is a no-op — re-writing it would stack a dead entry.
    if (q === this.query()) return;
    void this.router.navigate(['/folder', folderSegment(this.folderId())], {
      queryParams: { q, scope: this.scopeParam() },
      replaceUrl: this.query() !== null,
    });
  }

  /**
   * Widens or narrows the search scope (issue #121's pill): written into the
   * URL beside `?q=` so the result list a click-through returns to is the
   * widened one. Not a history event — toggling replaces, never pushes.
   */
  setSearchScope(scope: 'folder' | 'all'): void {
    if (this.docId() !== null || scope === this.searchScope()) return;
    void this.router.navigate(['/folder', folderSegment(this.folderId())], {
      queryParams: { q: this.query(), scope: scope === 'all' ? 'all' : null },
      replaceUrl: true,
    });
  }

  private readRoute(): void {
    let route = this.router.routerState.snapshot.root;
    let folderId: string | null = null;
    let docId: string | null = null;
    let docLinked = false;
    while (route.firstChild) {
      route = route.firstChild;
      folderId = parseFolderSegment(route.paramMap.get('folderId')) ?? folderId;
      docId = route.paramMap.get('docId') ?? docId;
      if (route.paramMap.get('docLink') !== null) docLinked = true;
    }
    this.folderId.set(folderId);
    this.docId.set(docId);
    // queryParamMap can be absent on the bare root snapshot before the first
    // navigation (TestBed without a router outlet).
    this.query.set(route.queryParamMap?.get('q') ?? null);
    this.searchScope.set(route.queryParamMap?.get('scope') === 'all' ? 'all' : 'folder');
    const page = Number(route.queryParamMap?.get('page'));
    this.deepLink.set(
      docLinked && docId !== null
        ? {
            documentId: docId,
            page: Number.isInteger(page) && page >= 1 ? page : null,
            item: route.queryParamMap?.get('item') ?? null,
          }
        : null,
    );
  }

  private scopeParam(): 'all' | null {
    return this.searchScope() === 'all' ? 'all' : null;
  }
}

function browseCommands(folderId: string | null): string[] {
  return folderId === null ? ['/'] : ['/folder', folderId];
}
