/**
 * PROTOTYPE — throwaway, never ship. Question: how do we make the Folder
 * "Needs your attention" panel (#120) less information-dense, especially on
 * phone widths, following Apple HIG list guidance? Three variants plus the
 * current panel, switchable via `?variant=current|A|B|C` on the existing
 * library route, fed by the real attention groups.
 *
 *   A  Inset grouped list — one column, timing folded into the subtitle, chevron.
 *   B  By Document — Document/path stated once as a section header, items beneath.
 *   C  Top items + sheet — three one-line items, "See All" opens a sheet.
 *
 * Round 2 (C chosen): two independent pickers on C — `?marker=text|dot|icon`
 * (urgency markers, applied identically in the card and the sheet) and
 * `?badge=red-if-overdue|grey|none` (header count). `?sample=1` injects a
 * "This week" item so the orange state shows on seed data.
 */
import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, effect, input, isDevMode, output, signal } from '@angular/core';
import type { AttentionGroup, AttentionGroupKey, AttentionItem } from './attention-overview';
import { AttentionPanel } from './attention-panel';

const VARIANTS = ['current', 'A', 'B', 'C'] as const;
type Variant = (typeof VARIANTS)[number];
const NAMES: Record<Variant, string> = {
  current: 'Current panel',
  A: 'Inset grouped list',
  B: 'By Document',
  C: 'Top items + sheet',
};

interface Flat extends AttentionItem {
  key: AttentionGroupKey;
}

const flatten = (groups: AttentionGroup[]): Flat[] =>
  groups.flatMap((g) => g.items.map((item) => ({ ...item, key: g.key })));

/** Short trailing timing for one-line rows: urgency words, not sentences. */
const shortTiming = (item: Flat): string => {
  if (item.key === 'overdue') return 'Overdue';
  if (item.key === 'noDate') return '';
  const label = item.timingLabel.replace(/^Due /, '');
  return label.charAt(0).toUpperCase() + label.slice(1);
};

const SHARED_STYLES = `
  :host { display: block; margin-top: var(--kt-space-4); }
  button { font: inherit; color: inherit; background: none; border: 0; padding: 0; cursor: pointer; text-align: left; }
  .head { display: flex; align-items: center; gap: var(--kt-space-2); min-height: var(--kt-touch-target); }
  .title { font-size: 17px; font-weight: 600; letter-spacing: -0.01em; }
  .count { min-width: 20px; padding: 0 6px; border-radius: 10px; background: var(--kt-danger); color: #fff; font-size: 12px; font-weight: 600; line-height: 20px; text-align: center; }
  .text-btn { margin-left: auto; color: var(--kt-accent); font-size: 15px; min-height: var(--kt-touch-target); padding: 0 var(--kt-space-1); }
  .note { color: var(--kt-text-muted); font-size: 15px; padding: var(--kt-space-2) 0; }
  .clamp2 { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
  .ellipsis { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  .chev { flex-shrink: 0; color: var(--kt-text-faint); display: flex; }
  .is-overdue { color: var(--kt-danger); }
`;

/** A — HIG inset grouped list: section headers outside, one column, disclosure chevrons. */
@Component({
  selector: 'app-attention-variant-a',
  template: `
    <section aria-label="Needs your attention">
      <div class="head">
        <span class="title">Needs your attention</span>
        @if (total() > 0) { <span class="count">{{ total() }}</span> }
        <button type="button" class="text-btn" (click)="open.set(!open())">{{ open() ? 'Hide' : 'Show' }}</button>
      </div>
      @if (open()) {
        @if (reading(); as r) {
          <p class="note">Reading {{ r.read }} of {{ r.total }} documents…</p>
        } @else if (total() === 0) {
          <p class="note">Nothing needs your attention.</p>
        }
        @for (group of groups(); track group.key) {
          <h3 class="sec" [class.is-overdue]="group.key === 'overdue'">{{ group.label }}</h3>
          <ul class="inset">
            @for (item of group.items; track item.id) {
              <li>
                <button type="button" class="row" (click)="itemOpened.emit(item)" [attr.title]="item.path ?? null">
                  <span class="body">
                    <span class="primary clamp2">{{ item.text }}</span>
                    <span class="secondary ellipsis">
                      @if (group.key !== 'noDate') {
                        <span [class.is-overdue]="group.key === 'overdue'">{{ item.timingLabel }}</span> ·
                      }
                      <span lang="de">{{ item.documentTitle }}</span>
                    </span>
                  </span>
                  <span class="chev"><svg width="8" height="13" viewBox="0 0 8 13" aria-hidden="true"><path d="M1.5 1.5 6.5 6.5 1.5 11.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
                </button>
              </li>
            }
          </ul>
        }
      }
    </section>
  `,
  styles: [
    SHARED_STYLES,
    `
    .sec { margin: var(--kt-space-3) 0 6px var(--kt-space-4); font-size: 13px; font-weight: 400; color: var(--kt-text-muted); }
    .sec.is-overdue { color: var(--kt-danger); font-weight: 600; }
    .inset { list-style: none; margin: 0; padding: 0; background: var(--kt-surface); border-radius: 10px; overflow: hidden; }
    .inset li + li .row::before { content: ''; position: absolute; top: 0; left: var(--kt-space-4); right: 0; border-top: 0.5px solid var(--kt-border); }
    .row { position: relative; display: flex; align-items: center; gap: var(--kt-space-3); width: 100%; min-height: var(--kt-touch-target); padding: 11px var(--kt-space-4); }
    .row:active { background: var(--kt-fill); }
    .body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .primary { font-size: 15px; line-height: 20px; }
    .secondary { font-size: 13px; color: var(--kt-text-muted); }
  `,
  ],
})
export class AttentionVariantA {
  readonly groups = input.required<AttentionGroup[]>();
  readonly reading = input<{ read: number; total: number } | null>(null);
  readonly itemOpened = output<AttentionItem>();
  protected readonly open = signal(true);
  protected readonly total = computed(() => this.groups().reduce((n, g) => n + g.items.length, 0));
}

interface DocGroup {
  documentId: string;
  documentTitle: string;
  path: string | null;
  items: Flat[];
}

const RANK: Record<AttentionGroupKey, number> = { overdue: 0, thisWeek: 1, later: 2, noDate: 3 };

/** B — grouped by Document: title/path once, items beneath with only a timing badge when dated. */
@Component({
  selector: 'app-attention-variant-b',
  template: `
    <section aria-label="Needs your attention">
      <div class="head">
        <span class="title">Needs your attention</span>
        <button type="button" class="text-btn" (click)="open.set(!open())">{{ open() ? 'Hide' : 'Show' }}</button>
      </div>
      <div class="summary">
        @for (s of summary(); track s.key) {
          <span class="pill" [class.pill-danger]="s.key === 'overdue'">{{ s.count }} {{ s.label }}</span>
        }
      </div>
      @if (open()) {
        @if (reading(); as r) {
          <p class="note">Reading {{ r.read }} of {{ r.total }} documents…</p>
        } @else if (docs().length === 0) {
          <p class="note">Nothing needs your attention.</p>
        }
        @for (doc of docs(); track doc.documentId) {
          <div class="doc">
            <div class="doc-head">
              <svg class="doc-icon" width="16" height="20" viewBox="0 0 16 20" aria-hidden="true"><path d="M2 1h8l5 5v12a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1Z" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>
              <span class="doc-text">
                <span class="doc-title ellipsis" lang="de">{{ doc.documentTitle }}</span>
                @if (doc.path) { <span class="doc-path ellipsis" lang="de">{{ doc.path }}</span> }
              </span>
            </div>
            @for (item of doc.items; track item.id) {
              <button type="button" class="row" (click)="itemOpened.emit(item)">
                <span class="primary clamp2">{{ item.text }}</span>
                @if (item.key !== 'noDate') {
                  <span class="badge" [class.badge-danger]="item.key === 'overdue'">{{ shortTiming(item) }}</span>
                }
              </button>
            }
          </div>
        }
      }
    </section>
  `,
  styles: [
    SHARED_STYLES,
    `
    .summary { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: var(--kt-space-2); }
    .pill { padding: 3px 10px; border-radius: 999px; background: var(--kt-fill); color: var(--kt-text-muted); font-size: 13px; }
    .pill-danger { background: var(--kt-danger-tint); color: var(--kt-danger); font-weight: 600; }
    .doc { background: var(--kt-surface); border-radius: 12px; margin-top: var(--kt-space-2); overflow: hidden; }
    .doc-head { display: flex; align-items: center; gap: var(--kt-space-2); padding: 10px var(--kt-space-4) 4px; color: var(--kt-text-muted); }
    .doc-icon { flex-shrink: 0; }
    .doc-text { display: flex; flex-direction: column; min-width: 0; }
    .doc-title { font-size: 13px; font-weight: 600; color: var(--kt-text); }
    .doc-path { font-size: 12px; }
    .row { display: flex; align-items: flex-start; gap: var(--kt-space-3); width: 100%; min-height: var(--kt-touch-target); padding: 10px var(--kt-space-4); }
    .row + .row { border-top: 0.5px solid var(--kt-border); }
    .row:active { background: var(--kt-fill); }
    .primary { flex: 1; min-width: 0; font-size: 15px; line-height: 20px; }
    .badge { flex-shrink: 0; margin-top: 1px; padding: 1px 8px; border-radius: 6px; background: var(--kt-fill); color: var(--kt-text-muted); font-size: 12px; line-height: 18px; white-space: nowrap; }
    .badge-danger { background: var(--kt-danger-tint); color: var(--kt-danger); font-weight: 600; }
  `,
  ],
})
export class AttentionVariantB {
  readonly groups = input.required<AttentionGroup[]>();
  readonly reading = input<{ read: number; total: number } | null>(null);
  readonly itemOpened = output<AttentionItem>();
  protected readonly open = signal(true);
  protected readonly shortTiming = shortTiming;
  protected readonly summary = computed(() =>
    this.groups().map((g) => ({ key: g.key, count: g.items.length, label: g.label.toLowerCase() })),
  );
  protected readonly docs = computed(() => {
    const byDoc = new Map<string, DocGroup>();
    for (const item of flatten(this.groups())) {
      const doc = byDoc.get(item.documentId) ??
        { documentId: item.documentId, documentTitle: item.documentTitle, path: item.path, items: [] };
      doc.items.push(item);
      byDoc.set(item.documentId, doc);
    }
    const urgency = (d: DocGroup) => Math.min(...d.items.map((i) => RANK[i.key]));
    return [...byDoc.values()].sort((a, b) => urgency(a) - urgency(b));
  });
}

export const MARKERS = ['text', 'dot', 'icon'] as const;
export type Marker = (typeof MARKERS)[number];
export const BADGES = ['red-if-overdue', 'grey', 'none'] as const;
export type Badge = (typeof BADGES)[number];
export const MARKER_NAMES: Record<Marker, string> = {
  text: 'Coloured timing text',
  dot: 'Dot on exceptions',
  icon: 'Icon on exceptions',
};
export const BADGE_NAMES: Record<Badge, string> = {
  'red-if-overdue': 'Grey total, red overdue',
  grey: 'Grey total',
  none: 'No badge',
};

/** C — glanceable: the three most urgent items on one line each; "See All" opens a sheet. */
@Component({
  selector: 'app-attention-variant-c',
  imports: [NgTemplateOutlet],
  template: `
    <ng-template #markTpl let-key>
      @if (marker() !== 'text') {
        <span class="mark" aria-hidden="true">
          @if (key === 'overdue' || key === 'thisWeek') {
            @if (marker() === 'dot') {
              <span class="dot" [attr.data-key]="key"></span>
            } @else if (key === 'overdue') {
              <svg class="icon" data-key="overdue" width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="8" fill="currentColor"/><path d="M8 4v5" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/><circle cx="8" cy="11.6" r="1.1" fill="#fff"/></svg>
            } @else {
              <svg class="icon" data-key="thisWeek" width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="8" fill="currentColor"/><path d="M8 4.2V8l2.6 1.6" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
            }
          }
        </span>
      }
    </ng-template>

    <section aria-label="Needs your attention" class="card">
      <div class="head pad">
        <span class="title">Needs your attention</span>
        @if (badge() !== 'none' && total() > 0) {
          @if (badge() === 'red-if-overdue' && overdue() > 0) {
            <span class="count" [attr.aria-label]="overdue() + ' overdue'">{{ overdue() }}</span>
          } @else {
            <span class="count count-grey" [attr.aria-label]="total() + ' items'">{{ total() }}</span>
          }
        }
        @if (total() > top().length) {
          <button type="button" class="text-btn" (click)="sheet.set(true)">See All</button>
        }
      </div>
      @if (reading(); as r) {
        <p class="note pad">Reading {{ r.read }} of {{ r.total }} documents…</p>
      } @else if (total() === 0) {
        <p class="note pad">Nothing needs your attention.</p>
      }
      @for (item of top(); track item.id) {
        <button type="button" class="line" (click)="itemOpened.emit(item)">
          <ng-container *ngTemplateOutlet="markTpl; context: { $implicit: item.key }" />
          <span class="line-text ellipsis">{{ item.text }}</span>
          @if (shortTiming(item); as t) {
            <span class="line-when" [attr.data-key]="marker() === 'text' ? item.key : null">{{ t }}</span>
          }
          <span class="chev"><svg width="8" height="13" viewBox="0 0 8 13" aria-hidden="true"><path d="M1.5 1.5 6.5 6.5 1.5 11.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
        </button>
      }
    </section>

    @if (sheet()) {
      <div class="scrim" (click)="sheet.set(false)"></div>
      <div class="sheet" role="dialog" aria-modal="true" aria-label="Needs your attention">
        <div class="grabber" aria-hidden="true"></div>
        <div class="sheet-head">
          <span class="title">Needs your attention</span>
          <button type="button" class="text-btn" (click)="sheet.set(false)">Done</button>
        </div>
        <div class="sheet-body">
          @for (group of groups(); track group.key) {
            <h3 class="sec" [class.is-overdue]="group.key === 'overdue'">{{ group.label }}</h3>
            <div class="inset">
              @for (item of group.items; track item.id) {
                <button type="button" class="sheet-row" (click)="sheet.set(false); itemOpened.emit(item)">
                  <ng-container *ngTemplateOutlet="markTpl; context: { $implicit: group.key }" />
                  <span class="sheet-col">
                    <span class="sheet-text">{{ item.text }}</span>
                    <span class="sheet-meta">
                      @if (group.key !== 'noDate') {
                        <span [attr.data-key]="marker() === 'text' ? group.key : null" class="sheet-when">{{ item.timingLabel }}</span><br />
                      }
                      <span lang="de">{{ item.documentTitle }}</span>@if (item.page) { · page {{ item.page }} }
                      @if (item.path) { <br /><span lang="de">{{ item.path }}</span> }
                    </span>
                  </span>
                </button>
              }
            </div>
          }
        </div>
      </div>
    }
  `,
  styles: [
    SHARED_STYLES,
    `
    .card { background: var(--kt-surface); border: 1px solid var(--kt-border); border-radius: 12px; overflow: hidden; }
    .pad { padding: 0 var(--kt-space-4); }
    .line { display: flex; align-items: center; gap: var(--kt-space-3); width: 100%; min-height: var(--kt-touch-target); padding: 0 var(--kt-space-4); border-top: 0.5px solid var(--kt-border); }
    .line:active { background: var(--kt-fill); }
    .count-grey { background: var(--kt-fill-strong); color: var(--kt-text-muted); }
    .mark { flex-shrink: 0; width: 16px; display: flex; align-items: center; justify-content: center; }
    .dot { width: 10px; height: 10px; border-radius: 50%; }
    .dot[data-key='overdue'] { background: var(--kt-danger); }
    .dot[data-key='thisWeek'] { background: var(--kt-warning); }
    .icon[data-key='overdue'] { color: var(--kt-danger); }
    .icon[data-key='thisWeek'] { color: var(--kt-warning); }
    .line-text { flex: 1; font-size: 15px; }
    .line-when { flex-shrink: 0; font-size: 13px; color: var(--kt-text-muted); }
    [data-key='overdue'].line-when, [data-key='overdue'].sheet-when { color: var(--kt-danger); font-weight: 600; }
    [data-key='thisWeek'].line-when, [data-key='thisWeek'].sheet-when { color: var(--kt-warning); font-weight: 600; }
    .scrim { position: fixed; inset: 0; background: rgb(0 0 0 / 0.3); z-index: 900; }
    .sheet { position: fixed; z-index: 901; left: 50%; bottom: 0; transform: translateX(-50%); width: min(560px, 100%); max-height: 88vh; display: flex; flex-direction: column; background: var(--kt-bg); border-radius: 14px 14px 0 0; box-shadow: var(--kt-shadow-popover); }
    @media (min-width: 769px) { .sheet { top: 50%; bottom: auto; transform: translate(-50%, -50%); border-radius: 14px; max-height: 80vh; } .grabber { display: none; } }
    .grabber { width: 36px; height: 5px; border-radius: 3px; background: var(--kt-border-strong); margin: 6px auto 0; }
    .sheet-head { display: flex; align-items: center; padding: var(--kt-space-2) var(--kt-space-4); }
    .sheet-body { overflow-y: auto; padding: 0 var(--kt-space-4) var(--kt-space-6); }
    .sec { margin: var(--kt-space-3) 0 6px var(--kt-space-4); font-size: 13px; font-weight: 400; color: var(--kt-text-muted); }
    .sec.is-overdue { color: var(--kt-danger); font-weight: 600; }
    .inset { background: var(--kt-surface); border-radius: 10px; overflow: hidden; }
    .sheet-row { display: flex; align-items: flex-start; gap: var(--kt-space-3); width: 100%; padding: 12px var(--kt-space-4); }
    .sheet-row .mark { height: 20px; }
    .sheet-col { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
    .sheet-row + .sheet-row { border-top: 0.5px solid var(--kt-border); }
    .sheet-text { font-size: 15px; line-height: 20px; overflow-wrap: anywhere; }
    .sheet-meta { font-size: 13px; color: var(--kt-text-muted); overflow-wrap: anywhere; }
  `,
  ],
})
export class AttentionVariantC {
  readonly groups = input.required<AttentionGroup[]>();
  readonly reading = input<{ read: number; total: number } | null>(null);
  readonly marker = input<Marker>('text');
  readonly badge = input<Badge>('red-if-overdue');
  readonly itemOpened = output<AttentionItem>();
  protected readonly sheet = signal(false);
  protected readonly shortTiming = shortTiming;
  protected readonly total = computed(() => this.groups().reduce((n, g) => n + g.items.length, 0));
  protected readonly overdue = computed(() => this.groups().find((g) => g.key === 'overdue')?.items.length ?? 0);
  protected readonly top = computed(() => flatten(this.groups()).slice(0, 3));
}

const fromUrl = <T extends string>(param: string, options: readonly T[], fallback: T): T => {
  const raw = new URLSearchParams(location.search).get(param)?.toLowerCase();
  return options.find((o) => o.toLowerCase() === raw) ?? fallback;
};

const cycle = <T,>(options: readonly T[], current: T, delta: number): T =>
  options[(options.indexOf(current) + delta + options.length) % options.length]!;

/** Sample "This week" item so the orange state is visible on seed data, which has none. */
const withSampleThisWeek = (groups: AttentionGroup[]): AttentionGroup[] => {
  const donor = groups.flatMap((g) => g.items)[0];
  if (!donor || groups.some((g) => g.key === 'thisWeek')) return groups;
  const sample: AttentionItem = {
    ...donor,
    id: 'proto-this-week',
    text: 'Send the signed SEPA mandate back to your landlord.',
    timingLabel: 'Due in 3 days',
  };
  const out = [...groups];
  out.splice(groups[0]?.key === 'overdue' ? 1 : 0, 0, { key: 'thisWeek', label: 'This week', items: [sample] });
  return out;
};

/** Mounts the chosen variant in place of the real panel, plus the floating switcher. */
@Component({
  selector: 'app-attention-density-prototype',
  imports: [AttentionPanel, AttentionVariantA, AttentionVariantB, AttentionVariantC],
  host: { '(document:keydown)': 'onKey($event)' },
  template: `
    @switch (variant()) {
      @case ('current') { <app-attention-panel [groups]="shown()" [reading]="reading()" (itemOpened)="itemOpened.emit($event)" /> }
      @case ('A') { <app-attention-variant-a [groups]="shown()" [reading]="reading()" (itemOpened)="itemOpened.emit($event)" /> }
      @case ('B') { <app-attention-variant-b [groups]="shown()" [reading]="reading()" (itemOpened)="itemOpened.emit($event)" /> }
      @case ('C') { <app-attention-variant-c [groups]="shown()" [reading]="reading()" [marker]="marker()" [badge]="badge()" (itemOpened)="itemOpened.emit($event)" /> }
    }
    @if (dev) {
      <div class="proto-switcher" role="toolbar" aria-label="Prototype variant">
        @if (variant() === 'C') {
          <div class="proto-row">
            <span class="proto-key">Markers</span>
            <button type="button" (click)="marker.set(cycleOf(markers, marker(), -1))" aria-label="Previous marker style">‹</button>
            <span class="proto-val">{{ markerNames[marker()] }}</span>
            <button type="button" (click)="marker.set(cycleOf(markers, marker(), 1))" aria-label="Next marker style">›</button>
          </div>
          <div class="proto-row">
            <span class="proto-key">Badge</span>
            <button type="button" (click)="badge.set(cycleOf(badges, badge(), -1))" aria-label="Previous badge style">‹</button>
            <span class="proto-val">{{ badgeNames[badge()] }}</span>
            <button type="button" (click)="badge.set(cycleOf(badges, badge(), 1))" aria-label="Next badge style">›</button>
          </div>
        }
        <div class="proto-row">
          <span class="proto-key">Variant</span>
          <button type="button" (click)="step(-1)" aria-label="Previous variant">‹</button>
          <span class="proto-val">{{ variant() }} · {{ names[variant()] }}</span>
          <button type="button" (click)="step(1)" aria-label="Next variant">›</button>
        </div>
        <label class="proto-sample"><input type="checkbox" [checked]="sample()" (change)="sample.set(!sample())" /> Add a "This week" sample item</label>
      </div>
    }
  `,
  styles: `
    .proto-switcher { position: fixed; z-index: 2000; left: 50%; bottom: 16px; transform: translateX(-50%); display: flex; flex-direction: column; gap: 6px; padding: 8px 10px; border-radius: 16px; background: #111; color: #fff; font: 600 13px/1 system-ui, sans-serif; box-shadow: 0 6px 24px rgb(0 0 0 / 0.35); white-space: nowrap; }
    .proto-row { display: grid; grid-template-columns: 56px 28px 180px 28px; align-items: center; gap: 6px; }
    .proto-key { color: #999; font-weight: 500; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; }
    .proto-val { text-align: center; overflow: hidden; text-overflow: ellipsis; }
    .proto-switcher button { width: 28px; height: 28px; border-radius: 50%; border: 0; background: #333; color: #fff; font-size: 16px; cursor: pointer; }
    .proto-sample { display: flex; align-items: center; gap: 6px; color: #bbb; font-weight: 500; font-size: 12px; padding-left: 2px; }
  `,
})
export class AttentionDensityPrototype {
  readonly groups = input.required<AttentionGroup[]>();
  readonly reading = input<{ read: number; total: number } | null>(null);
  readonly itemOpened = output<AttentionItem>();
  protected readonly dev = isDevMode() || new URLSearchParams(location.search).has('variant');
  protected readonly names = NAMES;
  protected readonly markers = MARKERS;
  protected readonly badges = BADGES;
  protected readonly markerNames = MARKER_NAMES;
  protected readonly badgeNames = BADGE_NAMES;
  protected readonly cycleOf = cycle;
  protected readonly variant = signal<Variant>(fromUrl('variant', VARIANTS, 'C'));
  protected readonly marker = signal<Marker>(fromUrl('marker', MARKERS, 'text'));
  protected readonly badge = signal<Badge>(fromUrl('badge', BADGES, 'red-if-overdue'));
  protected readonly sample = signal(new URLSearchParams(location.search).get('sample') === '1');
  protected readonly shown = computed(() => (this.sample() ? withSampleThisWeek(this.groups()) : this.groups()));

  constructor() {
    effect(() => {
      const url = new URL(location.href);
      url.searchParams.set('variant', this.variant());
      url.searchParams.set('marker', this.marker());
      url.searchParams.set('badge', this.badge());
      if (this.sample()) url.searchParams.set('sample', '1');
      else url.searchParams.delete('sample');
      history.replaceState(history.state, '', url);
    });
  }

  protected step(delta: number): void {
    this.variant.set(cycle(VARIANTS, this.variant(), delta));
  }

  protected onKey(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    if (target?.closest('input, textarea, select, [contenteditable]')) return;
    if (event.key === 'ArrowLeft') this.step(-1);
    if (event.key === 'ArrowRight') this.step(1);
  }
}
