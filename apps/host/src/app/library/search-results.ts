import { Component, computed, input, output } from '@angular/core';
import type {
  DocumentSearchResult,
  SearchResults as SearchSections,
} from './library-search';

/**
 * The library's inline search results (issue #121): Folders above Documents,
 * each row wearing the reason badges that explain its match and the matched
 * field's text as a snippet. Presentational — the Library owns the query, the
 * scope and what a click does (browse a Folder, open a Document at its cited
 * passage via PageFocus).
 */
@Component({
  selector: 'app-search-results',
  templateUrl: './search-results.html',
  styleUrl: './search-results.scss',
})
export class SearchResults {
  readonly results = input.required<SearchSections>();
  readonly query = input.required<string>();
  /** Set while the Extraction index is still loading: "Reading read of total documents…". */
  readonly reading = input<{ read: number; total: number } | null>(null);

  readonly folderOpened = output<string>();
  readonly documentOpened = output<DocumentSearchResult>();

  protected readonly count = computed(
    () => this.results().folders.length + this.results().documents.length,
  );

  protected readonly summary = computed(
    () => `${this.count()} ${this.count() === 1 ? 'result' : 'results'} for “${this.query()}”`,
  );
}
