import {
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  isDevMode,
  signal,
  viewChild,
} from '@angular/core';
import { ExtractionFlow } from '../bus/extraction-flow';
import { provideDocumentData } from '../data/providers';
import type { DocumentRecord } from '../data/document';
import type { FolderRecord } from '../data/folder';
import { OpenDocument } from '../open-document';
import { Reader } from '../reader/reader';
import { AttentionPanel } from './attention-panel';
import { buildAttentionOverview, readyDocumentsInScope, type AttentionItem } from './attention-overview';
import { DeleteDialog } from './delete-dialog';
import { DocumentTile, type TileAction } from './document-tile';
import { describeContents } from './folder-contents';
import { FolderDeleteDialog } from './folder-delete-dialog';
import { isItemDrag, type DragItem } from './folder-drag';
import { FolderNameDialog, type FolderNameResult } from './folder-name-dialog';
import { FolderTile, type FolderTileAction } from './folder-tile';
import { FolderTreeView } from './folder-tree';
import { MoveDialog } from './move-dialog';
import { RenameDialog } from './rename-dialog';
import { SearchResults } from './search-results';
import { buildSearchResults, type DocumentSearchResult } from './library-search';
import {
  ProtoChrome,
  ProtoSwitcher,
  PROTO_VARIANT_KEY,
  type ProtoVariant,
} from './prototype-mobile-search';
import { UploadDialog } from './upload-dialog';
import { LibraryStore } from './library.store';

/** Typing settles this long before the query lands in `?q=` (issue #121). */
const SEARCH_DEBOUNCE_MS = 200;

type DialogState =
  | { kind: 'upload' }
  | { kind: 'rename'; doc: DocumentRecord }
  | { kind: 'move'; doc: DocumentRecord }
  | { kind: 'delete'; doc: DocumentRecord }
  | { kind: 'new-folder' }
  | { kind: 'rename-folder'; folder: FolderRecord }
  | { kind: 'move-folder'; folder: FolderRecord }
  | { kind: 'delete-folder'; folder: FolderRecord }
  | null;

/**
 * The Files-style Document library (issues #28, #29): tile grid + toolbar over
 * the live Firestore feed, drop-to-upload on the grid, the per-state ⋮ menus,
 * the dialogs, and (issue #33) the sidebar Folder tree, Folder tiles and
 * drag-to-file. The URL's Folder filters the grid.
 *
 * While a Document is open, this renders the `app-reader` split view: the
 * pdf.js viewer left, the Guest insights panel right (ADR 0002).
 */
@Component({
  selector: 'app-library',
  templateUrl: './library.html',
  styleUrls: ['./library.scss', './search-field.scss'],
  imports: [
    AttentionPanel,
    DocumentTile,
    FolderTile,
    FolderTreeView,
    Reader,
    UploadDialog,
    RenameDialog,
    MoveDialog,
    DeleteDialog,
    FolderNameDialog,
    FolderDeleteDialog,
    SearchResults,
    ProtoChrome,
    ProtoSwitcher,
  ],
  host: {
    '(document:keydown.escape)': 'closeAddMenu()',
    '(document:keydown)': 'onGlobalKeydown($event)',
    '[class.reading]': 'openDocument.docId() !== null',
    // Desktop: the card makes room for the floating insights lane beside it.
    '[class.lane-open]': 'openDocument.docId() !== null && !openDocument.insightsLaneHidden()',
    // Mobile: the collapsed toolbar field expands while searching (#121).
    '[class.search-open]': 'searchOpen() || searching()',
  },
  // The data layer is scoped to the signed-in session: this component only
  // exists inside the auth gate's signed-in branch.
  providers: [...provideDocumentData(), ExtractionFlow],
})
export class Library {
  protected readonly store = inject(LibraryStore);
  protected readonly dialog = signal<DialogState>(null);
  // Instantiating starts Session flow + Extraction Job orchestration for
  // the signed-in session (issue #31); it self-attaches to the Bus, and the
  // tile's ⋮ Retry analysis routes through it (issue #32).
  protected readonly flow = inject(ExtractionFlow);

  /** The Folder attention overview (issue #120): Action Items under the browsed Folder, deep. */
  protected readonly attention = computed(() =>
    buildAttentionOverview({
      scoped: this.scoped(),
      extractions: this.store.extractionsByDocId(),
      today: new Date(),
    }),
  );

  private readonly scoped = computed(() =>
    this.scopedDocuments(this.openDocument.folderId()),
  );

  /** "Reading n of m documents…" while the Extraction index is still loading. */
  protected readonly reading = computed(() => {
    if (this.store.extractionsLoaded()) return null;
    // While searching, the honest denominator is the search's own scope.
    const scope =
      this.searching() && this.openDocument.searchScope() === 'all'
        ? null
        : this.openDocument.folderId();
    const scoped = this.scopedDocuments(scope);
    const index = this.store.extractionsByDocId();
    return { read: scoped.filter(({ doc }) => index.has(doc.id)).length, total: scoped.length };
  });

  private scopedDocuments(scopeFolderId: string | null) {
    return readyDocumentsInScope(
      this.store.documents() ?? [],
      this.store.folders() ?? [],
      scopeFolderId,
    );
  }

  protected readonly dropHover = signal(false);
  protected readonly openDocument = inject(OpenDocument);
  protected readonly describeContents = describeContents;
  protected readonly title = computed(
    () => this.store.folderById(this.openDocument.folderId())?.name ?? 'Documents',
  );

  /**
   * Inside a Folder, the ‹ affordance's target — the Folder's own parent
   * (issue #55). `undefined` at root — or while the Folder's record hasn't
   * resolved — where the affordance doesn't show; `null` = the way up is
   * Documents. The sidebar tree that desktop navigates with is hidden on
   * mobile, so this is the way back up a level.
   */
  protected readonly backTarget = computed<string | null | undefined>(() => {
    const folderId = this.openDocument.folderId();
    if (folderId === null) return undefined;
    return this.store.folderById(folderId)?.parentId;
  });

  /** The ‹ affordance's label — the parent Folder's name, Documents at top level. */
  protected readonly backLabel = computed(() => {
    const target = this.backTarget();
    return target ? (this.store.folderById(target)?.name ?? 'Folder') : 'Documents';
  });

  protected back(): void {
    const target = this.backTarget();
    if (target !== undefined) this.openFolder(target);
  }

  /**
   * Library search (issue #121): the toolbar field's query lives in the URL
   * as `?q=` — typing calls `OpenDocument.search` (debounced; the field
   * answers at two characters), browser back out of a result lands on the
   * same results, and a deep link searches immediately. Scope defaults to
   * the browsed Folder's subtree; the "All documents" pill widens it
   * (`?scope=all`, so the round-trip restores it too). `/` and Cmd/Ctrl+K
   * focus the field.
   */
  protected readonly searchOpen = signal(false);
  private readonly searchBox = viewChild<ElementRef<HTMLInputElement>>('searchBox');
  private searchTimer: ReturnType<typeof setTimeout> | undefined;

  /**
   * PROTOTYPE (throwaway branch): the mobile-chrome variant the bottom bar
   * selects — `null` renders the production toolbar. Dev builds only.
   */
  protected readonly protoVariant = signal<ProtoVariant>(
    isDevMode()
      ? ((localStorage.getItem(PROTO_VARIANT_KEY) as ProtoVariant) ?? null)
      : null,
  );
  protected readonly protoEnabled = isDevMode();
  protected setProtoVariant(variant: ProtoVariant): void {
    this.protoVariant.set(variant);
    if (variant === null) localStorage.removeItem(PROTO_VARIANT_KEY);
    else localStorage.setItem(PROTO_VARIANT_KEY, variant);
  }

  protected readonly query = computed(() => this.openDocument.query() ?? '');
  protected readonly searching = computed(() => this.query().trim().length >= 2);

  protected readonly results = computed(() => {
    if (!this.searching()) return null;
    return buildSearchResults({
      query: this.query(),
      documents: this.store.documents() ?? [],
      folders: this.store.folders() ?? [],
      extractions: this.store.extractionsByDocId(),
      scopeFolderId:
        this.openDocument.searchScope() === 'all' ? null : this.openDocument.folderId(),
      browsedFolderId: this.openDocument.folderId(),
    });
  });

  constructor() {
    // A query arriving via deep link or browser back fills the field.
    effect(() => {
      const box = this.searchBox()?.nativeElement;
      const q = this.query();
      if (box && box.value !== q) box.value = q;
    });
  }

  /** `/` and Cmd/Ctrl+K focus the field — except inside fields and dialogs. */
  protected onGlobalKeydown(event: KeyboardEvent): void {
    const shortcut =
      (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey) ||
      (event.key.toLowerCase() === 'k' && (event.ctrlKey || event.metaKey));
    if (!shortcut || event.defaultPrevented || this.dialog() !== null) return;
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
    ) {
      return;
    }
    // The field doesn't render while a Document is open — nothing to focus.
    const box = this.searchBox()?.nativeElement;
    if (!box) return;
    event.preventDefault();
    this.searchOpen.set(true);
    box.focus();
    box.select();
  }

  /** Debounced — a `?q=` rewrite per keystroke would spam the router. */
  protected onSearchInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.openDocument.search(value), SEARCH_DEBOUNCE_MS);
  }

  /** Escape clears the query; pressed again it collapses the field (mobile). */
  protected onSearchEscape(): void {
    clearTimeout(this.searchTimer);
    if (this.query().trim().length > 0) this.openDocument.search('');
    else this.searchOpen.set(false);
  }

  protected clearSearch(): void {
    clearTimeout(this.searchTimer);
    this.openDocument.search('');
    this.searchBox()?.nativeElement.focus();
  }

  /** The mobile magnifier: expands the collapsed field and focuses it. */
  protected revealSearch(): void {
    this.searchOpen.set(true);
    // The field is display:none until the class lands — focus after the frame.
    setTimeout(() => this.searchBox()?.nativeElement.focus());
  }

  /** A Folder row browses it; a Document row opens at its cited passage when the match carried one. */
  protected openSearchResult(result: DocumentSearchResult): void {
    if (result.focus) this.store.openAt(result.doc.id, result.focus);
    else this.store.open(result.doc.id);
  }

  /**
   * The + affordance's menu (issue #59): on phone widths the toolbar's two
   * creation verbs — upload and New folder — collapse into this one menu,
   * leaving the navigation row just ‹ parent and +.
   */
  protected readonly addMenuOpen = signal(false);

  protected toggleAddMenu(): void {
    this.addMenuOpen.update((open) => !open);
  }

  protected closeAddMenu(): void {
    this.addMenuOpen.set(false);
  }

  protected pickAdd(kind: 'upload' | 'new-folder'): void {
    this.addMenuOpen.set(false);
    this.dialog.set(kind === 'upload' ? { kind: 'upload' } : { kind: 'new-folder' });
  }

  protected openUpload(): void {
    this.dialog.set({ kind: 'upload' });
  }

  protected onPicked(picked: { files: File[]; folderId: string | null }): void {
    this.dialog.set(null);
    this.store.uploadFiles(picked.files, picked.folderId);
  }

  protected onFolderAction(folder: FolderRecord, action: FolderTileAction): void {
    switch (action) {
      case 'rename':
        this.dialog.set({ kind: 'rename-folder', folder });
        break;
      case 'move':
        this.dialog.set({ kind: 'move-folder', folder });
        break;
      case 'delete':
        this.dialog.set({ kind: 'delete-folder', folder });
        break;
      case 'retry-delete':
        void this.store.retryFolderDelete(folder.id);
        break;
    }
  }

  protected openAttentionItem(item: AttentionItem): void {
    this.store.openAt(
      item.documentId,
      item.page ? { page: item.page, quote: item.sourceQuote } : undefined,
    );
  }

  protected openFolder(folderId: string | null): void {
    this.openDocument.openFolder(folderId);
  }

  protected onItemDropped(item: DragItem, targetId: string | null): void {
    void this.store.dropItem(item, targetId);
  }

  protected newFolderTaken = (name: string): boolean =>
    this.store.nameTaken(this.openDocument.folderId(), name);

  protected renameTaken(folder: FolderRecord): (name: string) => boolean {
    return (name) => this.store.nameTaken(folder.parentId, name, folder.id);
  }

  protected onFolderNamed(result: FolderNameResult): void {
    const state = this.dialog();
    this.closeDialog();
    if (state?.kind === 'new-folder') void this.store.createFolder(result);
    else if (state?.kind === 'rename-folder') void this.store.renameFolder(state.folder.id, result.name);
  }

  protected onTileAction(doc: DocumentRecord, action: TileAction): void {
    switch (action) {
      case 'cancel-upload':
        this.store.cancelUpload(doc.id);
        break;
      case 'retry-upload':
        this.store.retryUpload(doc.id);
        break;
      case 'remove':
        void this.store.removeFailed(doc.id);
        break;
      case 'retry-delete':
        void this.store.retryDelete(doc.id);
        break;
      case 'rename':
        this.dialog.set({ kind: 'rename', doc });
        break;
      case 'move':
        this.dialog.set({ kind: 'move', doc });
        break;
      case 'download':
        void this.store.download(doc.id);
        break;
      case 'retry-extraction':
        this.flow.retryRequested(doc.id);
        break;
      case 'delete':
        this.dialog.set({ kind: 'delete', doc });
        break;
    }
  }

  /** Drop-to-retry: the first dropped file retries under the same documentId. */
  protected onTileDropped(doc: DocumentRecord, files: File[]): void {
    if (files[0]) this.store.retryWithFile(doc.id, files[0]);
  }

  /** Files dropped on the grid upload into the current Folder (root, #28). */
  protected onGridDrop(event: DragEvent): void {
    event.preventDefault();
    this.dropHover.set(false);
    if (!event.dataTransfer?.files.length) return;
    this.store.uploadFiles(event.dataTransfer?.files ?? []);
  }

  protected onGridDragOver(event: DragEvent): void {
    // In-app item drags (Folder/Document tiles) aren't uploads.
    if (isItemDrag(event)) return;
    event.preventDefault();
    this.dropHover.set(true);
  }

  protected onGridDragLeave(event: DragEvent): void {
    const grid = event.currentTarget as HTMLElement;
    if (!grid.contains(event.relatedTarget as Node | null)) this.dropHover.set(false);
  }

  protected closeDialog(): void {
    this.dialog.set(null);
  }
}
