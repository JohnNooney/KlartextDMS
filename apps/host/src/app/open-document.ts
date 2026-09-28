import { Injectable, signal } from '@angular/core';

/**
 * Which Document is open for reading, if any (issue #28). Kept app-global so
 * the library grid, the reader, and the Guest iframe's visibility all agree —
 * the frame stays mounted hidden for background Extraction Jobs and only
 * displays while a Document is open (issue #16).
 */
@Injectable({ providedIn: 'root' })
export class OpenDocument {
  /** The open Document's id, or `null` while browsing the library. */
  readonly id = signal<string | null>(null);

  open(documentId: string): void {
    this.id.set(documentId);
  }

  close(): void {
    this.id.set(null);
  }
}
