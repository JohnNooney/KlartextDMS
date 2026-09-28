import { Component, computed, inject, input, signal, viewChild } from '@angular/core';
import type { DocumentRecord } from '../data/document';
import type { FolderRecord } from '../data/folder';
import { LibraryStore } from '../library/library.store';
import { OpenDocument } from '../open-document';
import { PdfViewer } from './pdf-viewer';
import { siblingsOf, stepperFor } from './siblings';

/**
 * The open-Document view (issue #29): the "focus + back" reader from the
 * navigation prototype — `‹ {parent Folder}` back, the Document title opening
 * a macOS-style path menu, and a `‹ n of m ›` stepper through sibling
 * Documents — over the split that puts the Host-rendered PDF left and the
 * Guest insights panel right (ADR 0002).
 */
@Component({
  selector: 'app-reader',
  templateUrl: './reader.html',
  styleUrl: './reader.scss',
  imports: [PdfViewer],
})
export class Reader {
  readonly doc = input.required<DocumentRecord>();

  protected readonly openDocument = inject(OpenDocument);
  private readonly store = inject(LibraryStore);
  private readonly viewer = viewChild(PdfViewer);

  protected readonly pathMenuOpen = signal(false);

  /** The back button's target: the open Document's own Folder. */
  protected readonly parentLabel = computed(() => {
    const folderId = this.doc().folderId;
    if (folderId === null) return 'Documents';
    return this.store.folderById(folderId)?.name ?? 'Folder';
  });

  /** The Document's chain below root (path menu), deepest last. */
  protected readonly ancestry = computed(() => this.store.ancestryOf(this.doc().folderId));

  protected readonly pathMenuItems = computed<FolderRecord[]>(() =>
    [...this.ancestry()].reverse(),
  );

  protected readonly stepper = computed(() => {
    const documents = this.store.documents() ?? [];
    return stepperFor(siblingsOf(documents, this.doc().folderId), this.doc().id);
  });

  protected back(): void {
    // The `‹` label names the Document's own Folder — land there even if the
    // URL deep link browsed a different Folder.
    this.openDocument.close(this.doc().folderId);
  }

  protected openFolder(folderId: string | null): void {
    this.pathMenuOpen.set(false);
    this.openDocument.openFolder(folderId);
  }

  protected openSibling(doc: DocumentRecord | null): void {
    if (doc) this.store.open(doc.id);
  }

  /**
   * Page awareness for the Session layer: `GUEST_SHOW_PAGE` (#19) drives the
   * viewer through this — jump to a page and flash-mark it.
   */
  goToPage(n: number): void {
    this.viewer()?.goToPage(n);
  }
}
