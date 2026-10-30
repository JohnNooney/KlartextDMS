import { Component, computed, input, output, signal, viewChild } from '@angular/core';
import type { AttentionGroup, AttentionGroupKey, AttentionItem } from './attention-overview';
import { ModalSurface } from './modal-surface';
import { Sheet, type SheetDetent } from '../sheet';
import { SheetHandle } from '../sheet-handle';

/** How many of the most urgent Action Items the card shows; See All lists the rest. */
const CARD_ITEMS = 3;

/**
 * The See All sheet's detents (issue #153, ADR 0014): medium — about half
 * the viewport — and large, the full height. No peek; the sheet is
 * dismissible below medium.
 */
const ATTENTION_DETENTS: readonly SheetDetent[] = [
  { name: 'medium', height: ({ viewportHeight }) => viewportHeight * 0.5 },
  { name: 'large', height: ({ viewportHeight }) => viewportHeight },
];

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
  styleUrls: ['./attention-panel.scss', '../sheet.scss'],
  imports: [ModalSurface, Sheet, SheetHandle],
})
export class AttentionPanel {
  private readonly sheet = viewChild(Sheet);
  readonly groups = input.required<AttentionGroup[]>();
  /** Done items (issue #144) — hidden from the card, collapsed group in the sheet. */
  readonly done = input<AttentionItem[]>([]);
  /** Set while the Extraction index is still loading: "Reading read of total documents…". */
  readonly reading = input<{ read: number; total: number } | null>(null);
  readonly itemOpened = output<AttentionItem>();
  /** A row's "Add reminder" affordance (issue #122) — the Library opens the dialog. */
  readonly reminderRequested = output<AttentionItem>();
  /** A row's mark-done check or a Done row's un-mark (issue #144). */
  readonly doneToggled = output<{ item: AttentionItem; done: boolean }>();

  protected readonly expanded = signal(true);
  protected readonly sheetOpen = signal(false);
  /** The See All sheet's resting detent — reset to medium on every open. */
  protected readonly sheetDetent = signal('medium');
  protected readonly detents = ATTENTION_DETENTS;
  protected readonly doneOpen = signal(false);
  protected readonly toggle = (open: boolean): boolean => !open;

  /** The tap's result — the detent a tap moves to — for the grabber's label. */
  protected readonly handleLabel = computed(() =>
    this.sheet()?.next().name === 'large' ? 'Expand' : 'Collapse',
  );

  protected readonly count = computed(() =>
    this.groups().reduce((sum, group) => sum + group.items.length, 0),
  );

  protected readonly cardItems = computed<CardItem[]>(() =>
    this.groups()
      .flatMap((group) => group.items.map((item) => ({ item, key: group.key, when: cardTiming(group.key, item) })))
      .slice(0, CARD_ITEMS),
  );

  /** See All opens the sheet at medium — every open rests there (issue #153). */
  protected showSheet(): void {
    this.sheetDetent.set('medium');
    this.sheetOpen.set(true);
  }

  protected open(item: AttentionItem): void {
    this.sheetOpen.set(false);
    this.itemOpened.emit(item);
  }

  protected remind(item: AttentionItem): void {
    this.sheetOpen.set(false);
    this.reminderRequested.emit(item);
  }

  protected markDone(item: AttentionItem): void {
    this.doneToggled.emit({ item, done: true });
  }

  protected unmarkDone(item: AttentionItem): void {
    this.doneToggled.emit({ item, done: false });
  }
}

function cardTiming(key: AttentionGroupKey, item: AttentionItem): string {
  if (key === 'overdue') return 'Overdue';
  if (!item.timingLabel) return '';
  // A near monthly item reads "Due in 3 days · Monthly by the 25th" — the card keeps the date part.
  const label = (key === 'thisWeek' ? item.timingLabel.split(' · ')[0] : item.timingLabel).replace(/^Due /, '');
  return label.charAt(0).toUpperCase() + label.slice(1);
}
