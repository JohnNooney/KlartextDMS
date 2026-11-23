import { Component, computed, effect, input, output, signal, viewChild } from '@angular/core';
import { ModalSurface } from './modal-surface';
import { Sheet, type SheetDetent } from '../sheet';
import { SheetHandle } from '../sheet-handle';
import { AttentionPanel } from './attention-panel';
import type { AttentionGroup, AttentionGroupKey, AttentionItem } from './attention-overview';

/**
 * PROTOTYPE — throwaway, never ship. Four mobile attention banners and three
 * See All row layouts on the existing Library route, switchable via
 * `?variant=A|B|C|D` and the floating bar. Desktop and URLs without the param
 * keep the real panel. All phone fixtures and actions are in memory.
 */
const VARIANTS = ['A', 'B', 'C', 'D'] as const;
const SHEET_LAYOUTS = ['leading', 'footer', 'trailing'] as const;
const ITEM_COUNTS = ['0', '1', '65'] as const;
const EMPTY_TREATMENTS = ['text', 'hidden'] as const;

type Variant = (typeof VARIANTS)[number];
type SheetLayout = (typeof SHEET_LAYOUTS)[number];
type ItemCount = (typeof ITEM_COUNTS)[number];
type EmptyTreatment = (typeof EMPTY_TREATMENTS)[number];
interface CardItem {
  item: AttentionItem;
  key: AttentionGroupKey;
  when: string;
}

const NAMES: Record<Variant, string> = {
  A: 'Baseline',
  B: 'Count banner',
  C: 'Urgency banner',
  D: 'One-item peek',
};
const SHEET_NAMES: Record<SheetLayout, string> = {
  leading: 'Leading actions · wrap',
  footer: 'Action footer · wrap',
  trailing: 'Trailing actions · clip',
};
const DETENTS: readonly SheetDetent[] = [
  { name: 'medium', height: ({ viewportHeight }) => viewportHeight * 0.5 },
  { name: 'large', height: ({ viewportHeight }) => viewportHeight },
];

@Component({
  selector: 'app-mobile-attention-prototype-switcher',
  template: `
    <div class="proto-switcher" role="toolbar" aria-label="Mobile attention prototype">
      <div class="proto-control">
        <span class="proto-key">Variant</span>
        <button type="button" (click)="variantStep.emit(-1)" aria-label="Previous variant">
          ‹
        </button>
        <span class="proto-value">{{ variant() }} · {{ names[variant()] }}</span>
        <button type="button" (click)="variantStep.emit(1)" aria-label="Next variant">›</button>
      </div>
      <div class="proto-control">
        <span class="proto-key">Sheet</span>
        <button type="button" (click)="sheetStep.emit(-1)" aria-label="Previous sheet row layout">
          ‹
        </button>
        <span class="proto-value">{{ sheetNames[sheetLayout()] }}</span>
        <button type="button" (click)="sheetStep.emit(1)" aria-label="Next sheet row layout">
          ›
        </button>
      </div>
      <div class="proto-control">
        <span class="proto-key">Items</span>
        <button type="button" (click)="itemsStep.emit(-1)" aria-label="Previous item fixture">
          ‹
        </button>
        <span class="proto-value">{{ items() }} {{ items() === '1' ? 'item' : 'items' }}</span>
        <button type="button" (click)="itemsStep.emit(1)" aria-label="Next item fixture">›</button>
      </div>
      <div class="proto-toggles">
        <button
          type="button"
          (click)="emptyToggled.emit()"
          [attr.aria-pressed]="empty() === 'hidden'"
        >
          Empty: {{ empty() === 'text' ? 'one line' : 'no banner' }}
        </button>
        <button type="button" (click)="readingToggled.emit()" [attr.aria-pressed]="reading()">
          Reading: {{ reading() ? '2 of 8' : 'off' }}
        </button>
      </div>
      @if (lastAction()) {
        <p class="proto-status" role="status">{{ lastAction() }}</p>
      }
    </div>
  `,
  styles: `
    :host {
      display: contents;
    }
    button {
      border: 0;
      cursor: pointer;
    }
    .proto-switcher {
      position: fixed;
      z-index: 2000;
      left: 50%;
      bottom: max(12px, env(safe-area-inset-bottom));
      transform: translateX(-50%);
      display: flex;
      flex-direction: column;
      gap: 4px;
      max-width: calc(100vw - 24px);
      max-height: 48vh;
      overflow-y: auto;
      padding: 8px 10px;
      border-radius: 16px;
      background: #111;
      color: #fff;
      box-shadow: 0 6px 24px rgb(0 0 0 / 0.35);
      font:
        600 12px/1 system-ui,
        sans-serif;
      white-space: nowrap;
    }
    .proto-control {
      display: grid;
      grid-template-columns: 44px 28px minmax(120px, 1fr) 28px;
      align-items: center;
      gap: 4px;
    }
    .proto-key {
      color: #999;
      font-size: 10px;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .proto-value {
      overflow: hidden;
      text-align: center;
      text-overflow: ellipsis;
    }
    .proto-switcher button {
      min-width: 28px;
      min-height: 28px;
      border-radius: 14px;
      background: #333;
      color: #fff;
      font:
        600 15px/1 system-ui,
        sans-serif;
      text-align: center;
    }
    .proto-toggles {
      display: flex;
      gap: 6px;
    }
    .proto-toggles button {
      flex: 1;
      padding: 0 8px;
      font-size: 11px;
      white-space: nowrap;
    }
    .proto-status {
      max-width: 280px;
      margin: 3px 2px 0;
      color: #ddd;
      font-size: 11px;
      line-height: 1.3;
      white-space: normal;
    }
    @media (min-width: 769px) {
      :host {
        display: none;
      }
    }
  `,
})
export class MobileAttentionPrototypeSwitcher {
  readonly variant = input.required<Variant>();
  readonly sheetLayout = input.required<SheetLayout>();
  readonly items = input.required<ItemCount>();
  readonly empty = input.required<EmptyTreatment>();
  readonly reading = input.required<boolean>();
  readonly lastAction = input.required<string>();
  readonly variantStep = output<number>();
  readonly sheetStep = output<number>();
  readonly itemsStep = output<number>();
  readonly emptyToggled = output<void>();
  readonly readingToggled = output<void>();
  protected readonly names = NAMES;
  protected readonly sheetNames = SHEET_NAMES;
}

@Component({
  selector: 'app-mobile-attention-prototype',
  templateUrl: './mobile-attention-prototype.html',
  styleUrls: ['./mobile-attention-prototype.scss', '../sheet.scss'],
  imports: [AttentionPanel, MobileAttentionPrototypeSwitcher, ModalSurface, Sheet, SheetHandle],
  host: { '(document:keydown)': 'onKey($event)' },
})
export class MobileAttentionPrototype {
  private readonly sheet = viewChild(Sheet);
  readonly groups = input.required<AttentionGroup[]>();
  readonly done = input<AttentionItem[]>([]);
  readonly reading = input<{ read: number; total: number } | null>(null);
  readonly itemOpened = output<AttentionItem>();
  readonly reminderRequested = output<AttentionItem>();
  readonly doneToggled = output<{ item: AttentionItem; done: boolean }>();

  protected readonly enabled = new URLSearchParams(location.search).has('variant');
  protected readonly variant = signal<Variant>(fromUrl('variant', VARIANTS, 'A'));
  protected readonly sheetLayout = signal<SheetLayout>(fromUrl('sheet', SHEET_LAYOUTS, 'leading'));
  protected readonly items = signal<ItemCount>(fromUrl('items', ITEM_COUNTS, '65'));
  protected readonly empty = signal<EmptyTreatment>(fromUrl('empty', EMPTY_TREATMENTS, 'text'));
  protected readonly readingSample = signal(
    new URLSearchParams(location.search).get('reading') === '1',
  );
  protected readonly detents = DETENTS;
  protected readonly expanded = signal(true);
  protected readonly sheetOpen = signal(false);
  protected readonly sheetDetent = signal('medium');
  protected readonly lastAction = signal('');
  protected readonly toggle = (open: boolean): boolean => !open;

  protected readonly fixtureGroups = computed(() => makeFixtureGroups(this.items()));
  protected readonly count = computed(() =>
    this.fixtureGroups().reduce((sum, group) => sum + group.items.length, 0),
  );
  protected readonly overdue = computed(() => this.groupCount('overdue'));
  protected readonly thisWeek = computed(() => this.groupCount('thisWeek'));
  protected readonly countText = computed(
    () => `${this.count()} ${this.count() === 1 ? 'item needs' : 'items need'} your attention`,
  );
  protected readonly urgencySummary = computed(() => {
    const parts = [];
    if (this.overdue()) parts.push(`${this.overdue()} overdue`);
    if (this.thisWeek()) parts.push(`${this.thisWeek()} this week`);
    return parts.join(' · ');
  });
  protected readonly cardItems = computed<CardItem[]>(() =>
    this.fixtureGroups()
      .flatMap((group) =>
        group.items.map((item) => ({ item, key: group.key, when: cardTiming(group.key, item) })),
      )
      .slice(0, 3),
  );
  protected readonly first = computed<CardItem | null>(() => {
    const group = this.fixtureGroups()[0];
    const item = group?.items[0];
    return group && item ? { item, key: group.key, when: item.timingLabel ?? '' } : null;
  });
  protected readonly showBanner = computed(() => this.count() > 0 || this.empty() === 'text');
  protected readonly readingFixture = computed(() =>
    this.readingSample() ? { read: 2, total: 8 } : null,
  );
  protected readonly handleLabel = computed(() =>
    this.sheet()?.next().name === 'large' ? 'Expand' : 'Collapse',
  );

  constructor() {
    effect(() => {
      const url = new URL(location.href);
      url.searchParams.set('variant', this.variant());
      url.searchParams.set('sheet', this.sheetLayout());
      url.searchParams.set('items', this.items());
      url.searchParams.set('empty', this.empty());
      if (this.readingSample()) url.searchParams.set('reading', '1');
      else url.searchParams.delete('reading');
      history.replaceState(history.state, '', url);
    });
  }

  protected showSheet(): void {
    if (!this.count()) return;
    this.lastAction.set('');
    this.sheetDetent.set('medium');
    this.sheetOpen.set(true);
  }

  protected recordAction(message: string): void {
    this.lastAction.set(message);
  }

  protected stepVariant(delta: number): void {
    this.variant.set(cycle(VARIANTS, this.variant(), delta));
  }

  protected stepSheet(delta: number): void {
    this.sheetLayout.set(cycle(SHEET_LAYOUTS, this.sheetLayout(), delta));
  }

  protected stepItems(delta: number): void {
    const items = cycle(ITEM_COUNTS, this.items(), delta);
    this.items.set(items);
    if (items === '0') this.sheetOpen.set(false);
  }

  protected toggleEmpty(): void {
    this.empty.set(cycle(EMPTY_TREATMENTS, this.empty(), 1));
  }

  protected onKey(event: KeyboardEvent): void {
    if (!this.enabled) return;
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      target.closest('input, textarea, select, [contenteditable]')
    )
      return;
    if (event.key === 'ArrowLeft') this.stepVariant(-1);
    else if (event.key === 'ArrowRight') this.stepVariant(1);
    else return;
    event.preventDefault();
  }

  private groupCount(key: AttentionGroupKey): number {
    return this.fixtureGroups().find((group) => group.key === key)?.items.length ?? 0;
  }
}

function fromUrl<T extends string>(param: string, options: readonly T[], fallback: T): T {
  const raw = new URLSearchParams(location.search).get(param);
  return options.find((option) => option === raw) ?? fallback;
}

function cycle<T>(options: readonly T[], current: T, delta: number): T {
  return options[(options.indexOf(current) + delta + options.length) % options.length]!;
}

function cardTiming(key: AttentionGroupKey, item: AttentionItem): string {
  if (key === 'overdue') return 'Overdue';
  if (!item.timingLabel) return '';
  const label = (key === 'thisWeek' ? item.timingLabel.split(' · ')[0] : item.timingLabel).replace(
    /^Due /,
    '',
  );
  return label.charAt(0).toUpperCase() + label.slice(1);
}

const TEXTS = [
  'Bitte reichen Sie die vollständig ausgefüllte und unterschriebene Beitragsrückerstattungsanfrage einschließlich aller Originalbelege bis zum genannten Termin bei Ihrer Krankenversicherung ein.',
  'Send the signed SEPA mandate back to your landlord before the next collection.',
  'Confirm the new instalment amount in writing and keep the confirmation with the original agreement.',
  'Give three months’ notice in writing, including the signed cancellation form and your customer number.',
  'Check the annual statement and report any discrepancy to the provider.',
];
const DOCS = [
  'Beitragsanpassung und Sonderkündigungsrecht 2026.pdf',
  'Nebenkostenabrechnung 2025.pdf',
  'Änderung der Zahlungsbedingungen.pdf',
];
const PATHS = [
  'Wohnung / Versicherungen / Krankenversicherung / Beiträge / 2026',
  'Wohnung / Miete / Nebenkosten / Abrechnungen / 2025',
  'Finanzen / Verträge / Laufende Zahlungen',
];
const TIMING: Record<AttentionGroupKey, string[]> = {
  overdue: ['Overdue since 18 November', 'Overdue by 4 days', '2 weeks overdue'],
  thisWeek: [
    'Due in 3 days · Monthly on the 15th until the next invoice',
    'Due tomorrow',
    'Due in 5 days · 3 months’ notice · moving out',
  ],
  later: [
    'Monthly on the 15th until the next invoice',
    'Due 28 February 2027',
    '3 months’ notice · moving out',
  ],
  noDate: [],
};

function makeFixtureGroups(size: ItemCount): AttentionGroup[] {
  if (size === '0') return [];
  if (size === '1') return [{ key: 'later', label: 'Later', items: [fixtureItem(0, 'later')] }];
  const groups: AttentionGroup[] = [];
  for (const key of ['overdue', 'thisWeek', 'later', 'noDate'] as const) {
    const items = Array.from({ length: 65 }, (_, index) => ({ index, key }))
      .filter(({ index }) => {
        if (key === 'overdue') return index < 3;
        if (key === 'thisWeek') return index >= 3 && index < 8;
        if (key === 'later') return index >= 8 && index < 42;
        return index >= 42;
      })
      .map(({ index }) => fixtureItem(index, key));
    if (items.length) groups.push({ key, label: groupLabel(key), items });
  }
  return groups;
}

function fixtureItem(index: number, key: AttentionGroupKey): AttentionItem {
  return {
    id: `prototype-${index}`,
    text: TEXTS[index % TEXTS.length]!,
    documentId: `prototype-document-${index % DOCS.length}`,
    documentTitle: DOCS[index % DOCS.length]!,
    path: index % 4 === 3 ? null : PATHS[index % PATHS.length]!,
    page: (index % 9) + 1,
    sourceQuote: 'Prototype fixture',
    timingLabel: key === 'noDate' ? null : TIMING[key][index % TIMING[key].length]!,
  };
}

function groupLabel(key: AttentionGroupKey): string {
  return { overdue: 'Overdue', thisWeek: 'This week', later: 'Later', noDate: 'No date' }[key];
}
