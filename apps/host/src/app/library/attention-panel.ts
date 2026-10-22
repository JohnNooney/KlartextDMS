import { Component, input, output, signal } from '@angular/core';
import type { AttentionGroup, AttentionItem } from './attention-overview';

/**
 * The Folder attention overview (issue #120): a collapsible "Needs your
 * attention" panel above the tile grid. Presentational — the Library derives
 * the groups; a click reports the item so the Library can open its Document
 * at the cited page and quote.
 */
@Component({
  selector: 'app-attention-panel',
  templateUrl: './attention-panel.html',
  styleUrl: './attention-panel.scss',
})
export class AttentionPanel {
  readonly groups = input.required<AttentionGroup[]>();
  /** Set while the Extraction index is still loading: "Reading read of total documents…". */
  readonly reading = input<{ read: number; total: number } | null>(null);
  readonly itemOpened = output<AttentionItem>();

  protected readonly expanded = signal(true);

  protected count(): number {
    return this.groups().reduce((sum, group) => sum + group.items.length, 0);
  }
}
