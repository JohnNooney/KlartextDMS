import { Component, computed, input, output, signal } from '@angular/core';
import type { AttentionGroup, AttentionGroupKey, AttentionItem } from './attention-overview';
import { ModalSurface } from './modal-surface';

/** How many of the most urgent Action Items the card shows; See All lists the rest. */
const CARD_ITEMS = 3;

interface CardItem {
  item: AttentionItem;
  key: AttentionGroupKey;
  /** The card's short trailing timing: "Overdue", "In 3 days", "" for undated. */
  when: string;
}

/**
 * The Folder attention overview (issue #120): a collapsible "Needs your
 * attention" card above the tile grid holding the most urgent Action Items
 * on one line each, and a See All sheet with the full list grouped by
 * urgency (design settled on `prototype/attention-panel-density`).
 * Presentational — the Library derives the groups; a click reports the item
 * so the Library can open its Document at the cited page and quote.
 */
@Component({
  selector: 'app-attention-panel',
  templateUrl: './attention-panel.html',
  styleUrl: './attention-panel.scss',
  imports: [ModalSurface],
})
export class AttentionPanel {
  readonly groups = input.required<AttentionGroup[]>();
  /** Set while the Extraction index is still loading: "Reading read of total documents…". */
  readonly reading = input<{ read: number; total: number } | null>(null);
  readonly itemOpened = output<AttentionItem>();
  /** A row's "Add reminder" affordance (issue #122) — the Library opens the dialog. */
  readonly reminderRequested = output<AttentionItem>();

  protected readonly expanded = signal(true);
  protected readonly sheetOpen = signal(false);
  protected readonly toggle = (open: boolean): boolean => !open;

  protected readonly count = computed(() =>
    this.groups().reduce((sum, group) => sum + group.items.length, 0),
  );

  protected readonly cardItems = computed<CardItem[]>(() =>
    this.groups()
      .flatMap((group) => group.items.map((item) => ({ item, key: group.key, when: cardTiming(group.key, item) })))
      .slice(0, CARD_ITEMS),
  );

  protected open(item: AttentionItem): void {
    this.sheetOpen.set(false);
    this.itemOpened.emit(item);
  }

  protected remind(item: AttentionItem): void {
    this.sheetOpen.set(false);
    this.reminderRequested.emit(item);
  }
}

function cardTiming(key: AttentionGroupKey, item: AttentionItem): string {
  if (key === 'overdue') return 'Overdue';
  if (!item.timingLabel) return '';
  // A near monthly item reads "Due in 3 days · Monthly by the 25th" — the card keeps the date part.
  const label = (key === 'thisWeek' ? item.timingLabel.split(' · ')[0] : item.timingLabel).replace(/^Due /, '');
  return label.charAt(0).toUpperCase() + label.slice(1);
}
