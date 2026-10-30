/**
 * PROTOTYPE — throwaway, never ship. Question (#157): what does Batch
 * re-analysis look and feel like in the Host library and reader, desktop and
 * phone? Behavioural reference only, fed by in-memory mock data (not the real
 * library), mounted on the real library route so it sits against real chrome.
 *
 * Independent pickers in the floating switcher (also as URL params):
 *   ?nudge=meta|banner         meta-line link vs dismissible inline banner
 *   ?metaMobile=wrap|short|trailing   round 2: phone layout of the meta-line link
 *   ?readerStrip=none|pill     round 2: library keeps the strip below its toolbar;
 *                              the reader shows nothing, or a toolbar pill
 *   ?readerNudge=meta|notice   round 2: Guest nudge for an Outdated Extraction
 *                              (switching reloads — the Guest reads it at boot)
 *   ?criteria=radio|segmented  dialog criteria control
 *   ?scope=root|wohnung|nebenkosten   mock scope (the real grid is unrelated)
 *   ?outcome=ok|some|stop      how the simulated batch ends
 */
import {
  Component,
  computed,
  effect,
  inject,
  Injectable,
  input,
  isDevMode,
  signal,
} from '@angular/core';
import { ToastService } from '../toasts/toast.service';
import { ModalSurface } from './modal-surface';

// ---------------------------------------------------------------- mock data

interface MockDoc {
  id: string;
  title: string;
  path: string[];
  /** null = no Extraction (never analyzed, or the last run failed). */
  schemaVersion: 1 | 2 | null;
  failed: boolean;
  doneMarks: number;
}

const CURRENT = 2;

const seed = (): MockDoc[] => {
  const docs: MockDoc[] = [];
  const add = (title: string, path: string[], kind: 'old' | 'new' | 'fail', doneMarks = 0) =>
    docs.push({
      id: `m${docs.length}`,
      title,
      path,
      schemaVersion: kind === 'old' ? 1 : kind === 'new' ? 2 : null,
      failed: kind === 'fail',
      doneMarks,
    });
  const W = ['Wohnung'];
  const N = ['Wohnung', 'Nebenkosten'];
  add('Mietvertrag Bergmannstraße 12', W, 'old', 2);
  add('Hausordnung', W, 'old');
  add('Kautionsbestätigung', W, 'new');
  add('Übergabeprotokoll', W, 'fail');
  add('Mieterhöhung 2025', W, 'old');
  add('Schreiben der Hausverwaltung', W, 'new');
  add('Rauchmelder-Wartung', W, 'old');
  add('Nebenkostenabrechnung 2025', N, 'old', 1);
  add('Nebenkostenabrechnung 2024', N, 'old');
  add('Heizkostenabrechnung 2025', N, 'old');
  add('Wasserabrechnung', N, 'new');
  add('Grundsteuerbescheid', N, 'fail');
  add('Stromvertrag Vattenfall', N, 'old');
  add('Abschlagsänderung Strom', N, 'new');
  add('Rundfunkbeitrag', N, 'old');
  add('Gasvertrag', N, 'new');
  add('Versicherungsschein Hausrat', [], 'old', 1);
  add('Steuerbescheid 2024', [], 'new');
  add('Kündigung Fitnessstudio', [], 'new');
  add('Arbeitsvertrag', [], 'new');
  for (let m = 1; m <= 12; m++) add(`Kontoauszug 2021-${String(m).padStart(2, '0')}`, ['Archiv', 'Bank'], m % 3 === 0 ? 'old' : 'new');
  for (let m = 1; m <= 12; m++) add(`Lohnabrechnung 2022-${String(m).padStart(2, '0')}`, ['Archiv', 'Arbeit'], m % 4 === 0 ? 'old' : 'new');
  for (let i = 1; i <= 16; i++) add(`Rechnung ${1040 + i}`, ['Archiv'], i === 7 ? 'fail' : i % 3 === 0 ? 'old' : 'new');
  return docs;
};

// ---------------------------------------------------------------- options

const NUDGES = ['meta', 'banner'] as const;
const META_MOBILE = ['wrap', 'short', 'trailing'] as const;
const READER_STRIPS = ['none', 'pill'] as const;
const READER_NUDGES = ['meta', 'notice'] as const;
const CRITERIA_UI = ['radio', 'segmented'] as const;
const SCOPES = ['root', 'wohnung', 'nebenkosten'] as const;
const OUTCOMES = ['ok', 'some', 'stop'] as const;
type Nudge = (typeof NUDGES)[number];
type MetaMobile = (typeof META_MOBILE)[number];
type ReaderStrip = (typeof READER_STRIPS)[number];
type ReaderNudge = (typeof READER_NUDGES)[number];
type CriteriaUi = (typeof CRITERIA_UI)[number];
type Scope = (typeof SCOPES)[number];
type Outcome = (typeof OUTCOMES)[number];
export type Criterion = 'outdated' | 'failed' | 'all';

const NAMES: Record<string, string> = {
  meta: 'Meta-line link',
  banner: 'Inline banner',
  wrap: 'Wrap (round 1)',
  short: 'Short link',
  trailing: 'Trailing button',
  none: 'Nothing in reader',
  pill: 'Toolbar pill',
  notice: 'Inline notice',
  radio: 'Radio list',
  segmented: 'Segmented',
  root: 'Documents (root)',
  wohnung: 'Wohnung (+ Nebenkosten)',
  nebenkosten: 'Wohnung › Nebenkosten',
  ok: 'All succeed',
  some: '2 fail',
  stop: 'AI down → stop',
};

const SCOPE_PATHS: Record<Scope, string[]> = {
  root: [],
  wohnung: ['Wohnung'],
  nebenkosten: ['Wohnung', 'Nebenkosten'],
};

const fromUrl = <T extends string>(param: string, options: readonly T[], fallback: T): T => {
  const raw = new URLSearchParams(location.search).get(param);
  return options.find((o) => o === raw) ?? fallback;
};

const cycle = <T,>(options: readonly T[], current: T, delta: number): T =>
  options[(options.indexOf(current) + delta + options.length) % options.length]!;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const STEP_MS = 1400;

// ---------------------------------------------------------------- state

interface Batch {
  members: string[];
  /** Index of the member currently running; members before it are settled. */
  index: number;
  ok: number;
  failed: string[];
  consecutive: number;
  cancelling: boolean;
}

@Injectable({ providedIn: 'root' })
export class BatchProto {
  private readonly toasts = inject(ToastService);

  readonly nudge = signal<Nudge>(fromUrl('nudge', NUDGES, 'meta'));
  readonly metaMobile = signal<MetaMobile>(fromUrl('metaMobile', META_MOBILE, 'short'));
  readonly readerStrip = signal<ReaderStrip>(fromUrl('readerStrip', READER_STRIPS, 'none'));
  readonly readerNudge = signal<ReaderNudge>(fromUrl('readerNudge', READER_NUDGES, 'meta'));
  readonly criteriaUi = signal<CriteriaUi>(fromUrl('criteria', CRITERIA_UI, 'radio'));
  readonly scope = signal<Scope>(fromUrl('scope', SCOPES, 'wohnung'));
  readonly outcome = signal<Outcome>(fromUrl('outcome', OUTCOMES, 'ok'));

  readonly docs = signal<MockDoc[]>(seed());
  readonly dialogOpen = signal(false);
  readonly bannerDismissed = signal(false);
  readonly batch = signal<Batch | null>(null);
  private timer: ReturnType<typeof setTimeout> | undefined;

  readonly scopePath = computed(() => SCOPE_PATHS[this.scope()]);
  readonly scopeName = computed(() => this.scopePath().at(-1) ?? null);
  readonly scoped = computed(() => {
    const p = this.scopePath();
    return this.docs().filter((d) => p.every((seg, i) => d.path[i] === seg));
  });
  readonly matching = computed<Record<Criterion, MockDoc[]>>(() => {
    const docs = this.scoped();
    return {
      outdated: docs.filter((d) => d.schemaVersion !== null && d.schemaVersion < CURRENT),
      failed: docs.filter((d) => d.failed),
      all: docs.filter((d) => d.schemaVersion !== null || d.failed),
    };
  });
  readonly outdatedCount = computed(() => this.matching().outdated.length);
  readonly showNudge = computed(() => this.outdatedCount() > 0 && this.batch() === null);
  readonly running = computed(() => this.batch() !== null);
  readonly progress = computed(() => {
    const b = this.batch();
    if (!b) return null;
    return { current: Math.min(b.index + 1, b.members.length), total: b.members.length, cancelling: b.cancelling };
  });

  constructor() {
    effect(() => {
      const url = new URL(location.href);
      url.searchParams.set('nudge', this.nudge());
      url.searchParams.set('metaMobile', this.metaMobile());
      url.searchParams.set('readerStrip', this.readerStrip());
      url.searchParams.set('readerNudge', this.readerNudge());
      url.searchParams.set('criteria', this.criteriaUi());
      url.searchParams.set('scope', this.scope());
      url.searchParams.set('outcome', this.outcome());
      history.replaceState(history.state, '', url);
    });
  }

  relativePath(doc: MockDoc): string {
    return doc.path.slice(this.scopePath().length).join(' › ');
  }

  openDialog(): void {
    if (!this.running()) this.dialogOpen.set(true);
  }

  start(ids: string[]): void {
    this.dialogOpen.set(false);
    if (ids.length === 0) return;
    this.batch.set({ members: ids, index: 0, ok: 0, failed: [], consecutive: 0, cancelling: false });
    this.schedule();
  }

  cancel(): void {
    this.batch.update((b) => (b ? { ...b, cancelling: true } : b));
  }

  reset(): void {
    clearTimeout(this.timer);
    this.batch.set(null);
    this.docs.set(seed());
    this.bannerDismissed.set(false);
  }

  private schedule(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.step(), STEP_MS);
  }

  /** Settles the running member, then either advances or ends the batch. */
  private step(): void {
    const b = this.batch();
    if (!b) return;
    const id = b.members[b.index]!;
    const fails = this.simulatedFailure(b.index, b.members.length);
    if (fails) {
      b.failed = [...b.failed, id];
      b.consecutive += 1;
    } else {
      b.ok += 1;
      b.consecutive = 0;
      this.docs.update((docs) =>
        docs.map((d) => (d.id === id ? { ...d, schemaVersion: CURRENT, failed: false } : d)),
      );
    }
    const settled = b.index + 1;
    if (b.consecutive >= 3) return this.finish(b, 'stopped', settled);
    if (b.cancelling) return this.finish(b, 'cancelled', settled);
    if (settled >= b.members.length) return this.finish(b, 'done', settled);
    this.batch.set({ ...b, index: settled });
    this.schedule();
  }

  private simulatedFailure(index: number, total: number): boolean {
    switch (this.outcome()) {
      case 'ok':
        return false;
      case 'some':
        return index === 1 || index === Math.max(3, total - 2);
      case 'stop':
        return index >= Math.min(4, total - 1);
    }
  }

  private finish(b: Batch, how: 'done' | 'cancelled' | 'stopped', settled: number): void {
    this.batch.set(null);
    const total = b.members.length;
    const retry = (ids: string[]) => ({ label: 'Try again', run: () => this.start(ids) });
    if (how === 'stopped') {
      this.toasts.show({
        tone: 'error',
        title: 'Re-analysis stopped',
        body: `AI is unavailable right now. ${b.ok} of ${total} done.`,
        action: retry([...b.failed, ...b.members.slice(settled)]),
      });
    } else if (how === 'cancelled') {
      this.toasts.show({
        tone: 'info',
        title: 'Re-analysis cancelled',
        body: `${b.ok} of ${total} done.`,
        ...(b.failed.length ? { action: retry(b.failed) } : {}),
      });
    } else if (b.failed.length) {
      this.toasts.show({
        tone: 'error',
        title: `Re-analyzed ${b.ok} of ${total}`,
        body: `${b.failed.length} couldn't be analyzed`,
        action: retry(b.failed),
      });
    } else {
      this.toasts.show({ tone: 'success', title: `Re-analyzed ${plural(total, 'document')}` });
    }
  }
}

// ---------------------------------------------------------------- shared bits

const STRIP_STYLES = `
  .strip { display: flex; align-items: center; gap: var(--kt-space-3); min-height: 40px; padding: 0 var(--kt-space-2) 0 var(--kt-space-4); background: var(--kt-accent-tint); color: var(--kt-text); font-size: var(--kt-text-sm); position: relative; overflow: hidden; }
  .strip-label { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .strip-label b { font-weight: 600; font-variant-numeric: tabular-nums; }
  .strip-cancel { flex-shrink: 0; border: 0; background: transparent; color: var(--kt-accent); font: inherit; font-weight: 600; padding: 6px 10px; border-radius: var(--kt-radius-sm); cursor: pointer; min-height: 32px; }
  .strip-cancel:hover:not(:disabled) { background: var(--kt-fill); }
  .strip-cancel:disabled { color: var(--kt-text-muted); cursor: default; }
  .bar { position: absolute; left: 0; bottom: 0; height: 2px; background: var(--kt-accent); transition: width 0.4s ease; }
`;

/** The one progress line every placement shares: "Re-analyzing 3 of 14 · Cancel". */
@Component({
  selector: 'app-batch-proto-strip',
  template: `
    @if (proto.progress(); as p) {
      <div class="strip" role="status" [class.compact]="compact()">
        <span class="spinner" aria-hidden="true"></span>
        <span class="strip-label">
          @if (p.cancelling) {
            Finishing the current document…
          } @else {
            Re-analyzing <b>{{ p.current }} of {{ p.total }}</b>
          }
        </span>
        <button type="button" class="strip-cancel" [disabled]="p.cancelling" (click)="proto.cancel()">Cancel</button>
        <span class="bar" [style.width.%]="((p.current - 1) / p.total) * 100"></span>
      </div>
    }
  `,
  styles: [STRIP_STYLES, `:host { display: block; } .compact { min-height: 36px; }`],
})
export class BatchProtoStrip {
  protected readonly proto = inject(BatchProto);
  readonly compact = input(false);
}

/**
 * A placement slot. Each slot renders only when the chosen `?strip=` variant
 * targets it, so the same markup sits in library and reader.
 */
@Component({
  selector: 'app-batch-proto-slot',
  imports: [BatchProtoStrip],
  template: `
    @switch (slot()) {
      @case ('top') {
        @if (where() === 'library' && proto.running()) {
          <app-batch-proto-strip [compact]="true" />
        }
      }
      @case ('toolbar') {
        @if (where() === 'reader' && proto.readerStrip() === 'pill' && proto.progress(); as p) {
          <span class="pill-wrap">
            <button type="button" class="pill" (click)="open.set(!open())" aria-haspopup="dialog" [attr.aria-expanded]="open()" [attr.aria-label]="'Re-analyzing ' + p.current + ' of ' + p.total">
              <svg width="18" height="18" viewBox="0 0 36 36" aria-hidden="true">
                <circle cx="18" cy="18" r="14" fill="none" stroke="var(--kt-fill-strong)" stroke-width="4" />
                <circle cx="18" cy="18" r="14" fill="none" stroke="var(--kt-accent)" stroke-width="4" stroke-linecap="round"
                  [attr.stroke-dasharray]="88" [attr.stroke-dashoffset]="88 - 88 * ((p.current - 1) / p.total)" transform="rotate(-90 18 18)" />
              </svg>
              <span class="pill-n">{{ p.current }}/{{ p.total }}</span>
            </button>
            @if (open()) {
              <button type="button" class="menu-shield" (click)="open.set(false)" aria-hidden="true" tabindex="-1"></button>
              <div class="menu pill-pop" role="dialog" aria-label="Batch re-analysis">
                <app-batch-proto-strip />
              </div>
            }
          </span>
        }
      }
    }
  `,
  styles: `
    :host { display: contents; }
    .pill-wrap { position: relative; display: inline-flex; }
    .pill { display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 10px 0 8px; border: 0; border-radius: 16px; background: var(--kt-accent-tint); color: var(--kt-accent); font: inherit; font-size: var(--kt-text-xs); font-weight: 600; font-variant-numeric: tabular-nums; cursor: pointer; }
    .pill-pop { top: calc(100% + 6px); right: 0; width: 280px; padding: 0; overflow: hidden; }
  `,
})
export class BatchProtoSlot {
  protected readonly proto = inject(BatchProto);
  readonly slot = input.required<'top' | 'toolbar'>();
  readonly where = input.required<'library' | 'reader'>();
  protected readonly open = signal(false);
  constructor() {
    effect(() => {
      if (!this.proto.running()) this.open.set(false);
    });
  }
}

/** The library toolbar's ⋯ — the fixed entry point. */
@Component({
  selector: 'app-batch-proto-menu',
  template: `
    <span class="more-wrap">
      <button type="button" class="btn-more" (click)="open.set(!open())" aria-label="More" aria-haspopup="menu" [attr.aria-expanded]="open()">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="6" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="18" cy="12" r="1.6"/></svg>
      </button>
      @if (open()) {
        <button type="button" class="menu-shield" (click)="open.set(false)" aria-hidden="true" tabindex="-1"></button>
        <div class="menu more-menu" role="menu" aria-label="More">
          @if (proto.running()) {
            <div class="menu-item is-current" aria-disabled="true">
              <span class="spinner" aria-hidden="true"></span>
              <span class="muted">Re-analyzing documents</span>
            </div>
          } @else {
            <button type="button" class="menu-item" role="menuitem" (click)="open.set(false); proto.openDialog()">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4"/></svg>
              <span>Re-analyze documents</span>
            </button>
          }
        </div>
      }
    </span>
  `,
  styles: `
    .more-wrap { position: relative; display: inline-flex; }
    .btn-more { width: 36px; height: 36px; border: 0; border-radius: 50%; background: transparent; color: var(--kt-accent); display: grid; place-items: center; cursor: pointer; }
    .btn-more:hover { background: var(--kt-accent-tint); }
    .more-menu { top: calc(100% + 6px); right: 0; }
    .muted { color: var(--kt-text-muted); }
    @media (max-width: 768px) { .btn-more { width: var(--kt-touch-target); height: var(--kt-touch-target); background: var(--kt-accent-tint); } }
  `,
})
export class BatchProtoMenu {
  protected readonly proto = inject(BatchProto);
  protected readonly open = signal(false);
}

/** Nudge slots: `meta` replaces the meta line, `banner` sits above the attention panel. */
@Component({
  selector: 'app-batch-proto-nudge',
  template: `
    @if (slot() === 'meta') {
      <p class="meta-line" [attr.data-mobile]="proto.metaMobile()">
        <span>{{ docCount() }}</span>
        @if (proto.nudge() === 'meta' && proto.showNudge()) {
          <span class="desk">
            · {{ outdatedPhrase() }} —
            <button type="button" class="link" (click)="proto.openDialog()">Re-analyze</button>
          </span>
          <span class="m-short">
            · <button type="button" class="link" (click)="proto.openDialog()">Re-analyze {{ proto.outdatedCount() }} outdated</button>
          </span>
          <button type="button" class="m-trailing" (click)="proto.openDialog()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4"/></svg>
            Re-analyze {{ proto.outdatedCount() }}
          </button>
        }
      </p>
    } @else if (proto.nudge() === 'banner' && proto.showNudge() && !proto.bannerDismissed()) {
      <div class="banner" role="note">
        <svg class="banner-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4"/></svg>
        <div class="banner-text">
          <strong>{{ outdatedPhrase(true) }}</strong>
          <span>Re-analyze to get dates on what needs your attention.</span>
        </div>
        <button type="button" class="btn btn-tinted banner-go" (click)="proto.openDialog()">Re-analyze</button>
        <button type="button" class="close-btn banner-x" (click)="proto.bannerDismissed.set(true)" aria-label="Dismiss">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg>
        </button>
      </div>
    }
  `,
  styles: `
    :host { display: block; }
    .meta-line { margin: 0 0 0 6px; font-size: var(--kt-text-sm); color: var(--kt-text-muted); }
    .m-short, .m-trailing { display: none; }
    .m-trailing { align-items: center; gap: 4px; margin-left: auto; height: 28px; padding: 0 10px; border: 0; border-radius: 14px; background: var(--kt-accent-tint); color: var(--kt-accent); font: inherit; font-size: var(--kt-text-xs); font-weight: 600; cursor: pointer; flex-shrink: 0; }
    @media (max-width: 768px) {
      .meta-line[data-mobile='short'] .desk, .meta-line[data-mobile='trailing'] .desk { display: none; }
      .meta-line[data-mobile='short'] .m-short { display: inline; }
      .meta-line[data-mobile='trailing'] { display: flex; align-items: center; gap: var(--kt-space-2); }
      .meta-line[data-mobile='trailing'] .m-trailing { display: inline-flex; }
    }
    .link { border: 0; padding: 0; background: none; font: inherit; color: var(--kt-accent); cursor: pointer; }
    .link:hover { text-decoration: underline; }
    .banner { display: flex; align-items: center; gap: var(--kt-space-3); margin-top: var(--kt-space-4); padding: var(--kt-space-3) var(--kt-space-3) var(--kt-space-3) var(--kt-space-4); background: var(--kt-surface); border: 1px solid var(--kt-border); border-radius: var(--kt-radius-lg); }
    .banner-icon { flex-shrink: 0; color: var(--kt-accent); }
    .banner-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; font-size: var(--kt-text-sm); }
    .banner-text strong { font-weight: 600; }
    .banner-text span { color: var(--kt-text-muted); font-size: var(--kt-text-xs); }
    .banner-go { flex-shrink: 0; }
    @media (max-width: 768px) {
      .banner { flex-wrap: wrap; align-items: flex-start; }
      .banner-text { flex-basis: calc(100% - 80px); }
      .banner-x { order: 2; }
      .banner-go { order: 3; margin-left: 32px; }
    }
  `,
})
export class BatchProtoNudge {
  protected readonly proto = inject(BatchProto);
  readonly slot = input.required<'meta' | 'banner'>();
  protected readonly docCount = computed(() => plural(this.proto.scoped().length, 'document'));
  protected outdatedPhrase(sentence = false): string {
    const n = this.proto.outdatedCount();
    const verb = n === 1 ? 'uses' : 'use';
    return sentence
      ? `${plural(n, 'document')} ${verb} an earlier analysis format`
      : `${n} ${verb} an earlier analysis format`;
  }
}

// ---------------------------------------------------------------- dialog

const CRITERIA: { key: Criterion; label: string; hint: string; short: string }[] = [
  { key: 'outdated', label: 'Outdated format', short: 'Outdated', hint: 'Analyzed in an earlier format — no dates on Action Items.' },
  { key: 'failed', label: "Couldn't analyze", short: "Couldn't analyze", hint: 'The last analysis failed.' },
  { key: 'all', label: 'All documents', short: 'All', hint: 'Every analyzed document, including up-to-date ones.' },
];

@Component({
  selector: 'app-batch-proto-dialog',
  imports: [ModalSurface],
  template: `
    <div class="dialog batch" appModalSurface #surface="appModalSurface" role="dialog" aria-modal="true" aria-labelledby="batch-title" (closeRequested)="proto.dialogOpen.set(false)">
      <header class="dialog-head">
        <h2 id="batch-title">Re-analyze documents</h2>
        <button type="button" class="close-btn" (click)="surface.requestClose()" aria-label="Close">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg>
        </button>
      </header>

      <p class="dialog-body">
        @if (proto.scopeName(); as name) {
          In <strong lang="de">{{ name }}</strong> and the folders inside it.
        } @else {
          Across all your documents.
        }
        Klartext reads each one again with the current analysis.
      </p>

      @if (proto.criteriaUi() === 'radio') {
        <div class="radios" role="radiogroup" aria-label="Which documents">
          @for (c of criteria; track c.key) {
            <label class="radio" [class.is-disabled]="count(c.key) === 0" [class.is-on]="selected() === c.key">
              <input type="radio" name="criterion" [value]="c.key" [checked]="selected() === c.key" [disabled]="count(c.key) === 0" (change)="picked.set(c.key)" />
              <span class="radio-text">
                <span class="radio-label">{{ c.label }}</span>
                <span class="radio-hint">{{ c.hint }}</span>
              </span>
              <span class="radio-count">{{ count(c.key) }}</span>
            </label>
          }
        </div>
      } @else {
        <div class="seg" role="radiogroup" aria-label="Which documents">
          @for (c of criteria; track c.key) {
            <button type="button" role="radio" class="seg-btn" [class.is-on]="selected() === c.key" [attr.aria-checked]="selected() === c.key" [disabled]="count(c.key) === 0" (click)="picked.set(c.key)">
              {{ c.short }} <span class="seg-n">{{ count(c.key) }}</span>
            </button>
          }
        </div>
        <p class="seg-hint">{{ hint() }}</p>
      }

      @if (members().length) {
        <div class="list">
          <button type="button" class="list-toggle" [attr.aria-expanded]="listOpen()" (click)="listOpen.set(!listOpen())">
            <svg class="chev" [class.is-open]="listOpen()" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>
            {{ listOpen() ? 'Hide' : 'Show' }} {{ plural(members().length, 'document') }}
          </button>
          @if (listOpen()) {
            <ul class="list-rows">
              @for (doc of members(); track doc.id) {
                <li>
                  <span class="list-title" lang="de">{{ doc.title }}</span>
                  @if (proto.relativePath(doc); as path) { <span class="chip" lang="de">{{ path }}</span> }
                  @if (doc.doneMarks) { <span class="chip chip-done">{{ doc.doneMarks }} done</span> }
                </li>
              }
            </ul>
          }
        </div>
      }

      @if (withDone().length; as n) {
        <p class="warn">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.8 2.9 19.5h18.2z"/><path d="M12 10v4"/><path d="M12 16.9v.2"/></svg>
          <span>{{ n === 1 ? '1 of these documents has' : n + ' of these documents have' }} items marked Done. Re-analyzing can bring them back as not done, and a reminder you add again may duplicate one already in your calendar.</span>
        </p>
      }

      @if (members().length > 50) {
        <p class="quota">This is a large batch — {{ members().length }} documents can take several minutes and use a lot of your AI analysis. You can keep working meanwhile.</p>
      }

      <footer class="dialog-foot">
        <button type="button" class="btn btn-secondary" (click)="surface.requestClose()">Cancel</button>
        <button type="button" class="btn btn-primary" [disabled]="members().length === 0" (click)="proto.start(memberIds())" autofocus>
          @if (members().length) { Re-analyze {{ plural(members().length, 'document') }} } @else { Nothing to re-analyze }
        </button>
      </footer>
    </div>
  `,
  styleUrls: ['./dialogs.scss'],
  styles: `
    .batch { width: min(520px, calc(100vw - 32px)); }
    .radios { display: flex; flex-direction: column; border: 1px solid var(--kt-border); border-radius: var(--kt-radius-lg); overflow: hidden; }
    .radio { display: flex; align-items: center; gap: var(--kt-space-3); padding: var(--kt-space-3) var(--kt-space-4); cursor: pointer; min-height: var(--kt-touch-target); }
    .radio + .radio { border-top: 1px solid var(--kt-border); }
    .radio.is-on { background: var(--kt-accent-tint); }
    .radio.is-disabled { cursor: default; opacity: 0.45; }
    .radio input { margin: 0; accent-color: var(--kt-accent); width: 18px; height: 18px; flex-shrink: 0; }
    .radio-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .radio-label { font-size: var(--kt-text-sm); font-weight: 600; }
    .radio-hint { font-size: var(--kt-text-xs); color: var(--kt-text-muted); }
    .radio-count { flex-shrink: 0; min-width: 28px; text-align: right; font-size: var(--kt-text-sm); font-weight: 600; font-variant-numeric: tabular-nums; color: var(--kt-text-muted); }
    .seg { display: grid; grid-template-columns: repeat(3, 1fr); gap: 2px; padding: 2px; background: var(--kt-fill); border-radius: 9px; }
    .seg-btn { border: 0; background: transparent; border-radius: 7px; padding: 6px 4px; min-height: 34px; font: inherit; font-size: var(--kt-text-xs); font-weight: 500; cursor: pointer; color: var(--kt-text); }
    .seg-btn.is-on { background: var(--kt-bg); box-shadow: 0 1px 3px rgb(0 0 0 / 0.12); font-weight: 600; }
    .seg-btn:disabled { opacity: 0.4; cursor: default; }
    .seg-n { color: var(--kt-text-muted); font-variant-numeric: tabular-nums; margin-left: 2px; }
    .seg-hint { margin: calc(-1 * var(--kt-space-2)) 0 0; font-size: var(--kt-text-xs); color: var(--kt-text-muted); }
    .list-toggle { display: inline-flex; align-items: center; gap: 6px; border: 0; background: none; padding: 4px 0; font: inherit; font-size: var(--kt-text-sm); color: var(--kt-accent); cursor: pointer; }
    .chev { transition: transform 0.15s; }
    .chev.is-open { transform: rotate(90deg); }
    .list-rows { list-style: none; margin: var(--kt-space-2) 0 0; padding: 0; max-height: 200px; overflow-y: auto; border: 1px solid var(--kt-border); border-radius: var(--kt-radius-md); }
    .list-rows li { display: flex; align-items: center; gap: var(--kt-space-2); padding: 8px var(--kt-space-3); font-size: var(--kt-text-sm); }
    .list-rows li + li { border-top: 1px solid var(--kt-border); }
    .list-title { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .chip { flex-shrink: 0; max-width: 45%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding: 1px 8px; border-radius: 999px; background: var(--kt-fill); color: var(--kt-text-muted); font-size: var(--kt-text-xs); }
    .chip-done { background: var(--kt-warning-tint); color: var(--kt-warning-text); }
    .warn { display: flex; gap: var(--kt-space-2); margin: 0; padding: var(--kt-space-3); border-radius: var(--kt-radius-md); background: var(--kt-warning-tint); color: var(--kt-warning-text); font-size: var(--kt-text-sm); line-height: 1.4; }
    .warn svg { flex-shrink: 0; margin-top: 1px; }
    .quota { margin: 0; font-size: var(--kt-text-xs); color: var(--kt-text-muted); line-height: 1.4; }
    @media (max-width: 768px) { .dialog-foot { flex-direction: column-reverse; } .dialog-foot .btn { width: 100%; justify-content: center; } }
  `,
})
export class BatchProtoDialog {
  protected readonly proto = inject(BatchProto);
  protected readonly criteria = CRITERIA;
  protected readonly plural = plural;
  protected readonly picked = signal<Criterion | null>(null);
  protected readonly listOpen = signal(false);
  protected readonly selected = computed<Criterion | null>(() => {
    const m = this.proto.matching();
    const p = this.picked();
    if (p && m[p].length) return p;
    return CRITERIA.find((c) => m[c.key].length > 0)?.key ?? null;
  });
  protected readonly members = computed(() => {
    const s = this.selected();
    return s ? this.proto.matching()[s] : [];
  });
  protected readonly memberIds = computed(() => this.members().map((d) => d.id));
  protected readonly withDone = computed(() => this.members().filter((d) => d.doneMarks > 0));
  protected readonly hint = computed(() => CRITERIA.find((c) => c.key === this.selected())?.hint ?? '');
  protected count(c: Criterion): number {
    return this.proto.matching()[c].length;
  }
}

// ---------------------------------------------------------------- root

/** Mounted once on the library route: dialog and switcher. */
@Component({
  selector: 'app-batch-reanalysis-prototype',
  imports: [BatchProtoDialog],
  template: `
    @if (proto.dialogOpen()) { <app-batch-proto-dialog /> }
    @if (dev) {
      <div class="proto-switcher" [class.is-min]="minimized()" role="toolbar" aria-label="Prototype controls">
        <button type="button" class="proto-min" (click)="minimized.set(!minimized())">{{ minimized() ? 'Prototype ▴' : '▾' }}</button>
        @if (!minimized()) {
          @for (row of rows; track row.key) {
            <div class="proto-row">
              <span class="proto-key">{{ row.key }}</span>
              <button type="button" (click)="step(row, -1)" [attr.aria-label]="'Previous ' + row.key">‹</button>
              <span class="proto-val">{{ names[row.value()] }}</span>
              <button type="button" (click)="step(row, 1)" [attr.aria-label]="'Next ' + row.key">›</button>
            </div>
          }
          <div class="proto-actions">
            <button type="button" class="proto-text" (click)="proto.openDialog()" [disabled]="proto.running()">Open dialog</button>
            <button type="button" class="proto-text" (click)="proto.reset()">Reset mock</button>
          </div>
        }
      </div>
    }
  `,
  styles: [
    `
    .proto-switcher { position: fixed; z-index: 2000; left: 12px; bottom: 12px; display: flex; flex-direction: column; gap: 6px; padding: 8px 10px; border-radius: 16px; background: #111; color: #fff; font: 600 13px/1 system-ui, sans-serif; box-shadow: 0 6px 24px rgb(0 0 0 / 0.35); white-space: nowrap; opacity: 0.94; }
    .proto-switcher.is-min { padding: 4px; }
    .proto-min { align-self: flex-end; border: 0; background: #333; color: #fff; border-radius: 10px; font: inherit; font-size: 11px; padding: 4px 8px; cursor: pointer; }
    .proto-row { display: grid; grid-template-columns: 84px 26px 150px 26px; align-items: center; gap: 6px; }
    .proto-key { color: #999; font-weight: 500; font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; }
    .proto-val { text-align: center; overflow: hidden; text-overflow: ellipsis; }
    .proto-row button { width: 26px; height: 26px; border-radius: 50%; border: 0; background: #333; color: #fff; font-size: 16px; cursor: pointer; }
    .proto-actions { display: flex; gap: 6px; }
    .proto-text { flex: 1; border: 0; background: #333; color: #fff; border-radius: 10px; font: inherit; font-size: 12px; padding: 7px 8px; cursor: pointer; }
    .proto-text:disabled { opacity: 0.4; }
    @media (max-width: 768px) { .proto-row { grid-template-columns: 70px 26px 120px 26px; } }
  `,
  ],
})
export class BatchReanalysisPrototype {
  protected readonly proto = inject(BatchProto);
  protected readonly dev = isDevMode() || new URLSearchParams(location.search).has('nudge');
  protected readonly names = NAMES;
  protected readonly minimized = signal(false);
  protected readonly rows = [
    this.row('Nudge', this.proto.nudge, NUDGES),
    this.row('Phone meta', this.proto.metaMobile, META_MOBILE),
    this.row('Reader strip', this.proto.readerStrip, READER_STRIPS),
    this.row('Reader nudge', this.proto.readerNudge, READER_NUDGES, true),
    this.row('Criteria', this.proto.criteriaUi, CRITERIA_UI),
    this.row('Scope', this.proto.scope, SCOPES),
    this.row('Outcome', this.proto.outcome, OUTCOMES),
  ];

  /** The Guest reads `?readerNudge=` at boot, so that row reloads once the URL effect lands. */
  protected step(row: (typeof this.rows)[number], delta: number): void {
    row.step(delta);
    if (row.reload) setTimeout(() => location.reload(), 50);
  }

  private row<T extends string>(key: string, value: ReturnType<typeof signal<T>>, options: readonly T[], reload = false) {
    return { key, value, reload, step: (d: number) => value.set(cycle(options, value(), d)) };
  }
}
