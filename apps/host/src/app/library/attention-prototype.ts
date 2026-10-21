/**
 * PROTOTYPE (wayfinder ticket #102) — throwaway, never ship. Three variants of
 * the Folder "needs your attention" overview, switchable via `?variant=A|B|C`
 * on the existing library route. Items are MOCK data derived from Document ids;
 * nothing here reads Extractions. Click-through just opens the Document.
 */
import { Component, computed, inject, signal } from '@angular/core';
import { folderAncestry } from '../data/folder';
import type { DocumentRecord } from '../data/document';
import { OpenDocument } from '../open-document';
import { LibraryStore } from './library.store';

export const VARIANTS = ['A', 'B', 'C'] as const;
export type Variant = (typeof VARIANTS)[number];
const NAMES: Record<Variant, string> = {
  A: 'Top strip, grouped by urgency',
  B: 'Inline on tiles',
  C: 'Toolbar drawer, by document',
};

const initial = new URLSearchParams(location.search).get('variant')?.toUpperCase();
export const attentionVariant = signal<Variant>(
  VARIANTS.includes(initial as Variant) ? (initial as Variant) : 'A',
);

type Urgency = 'overdue' | 'soon' | 'later' | 'undated';
interface Item {
  doc: DocumentRecord;
  folderPath: string;
  text: string;
  when: string;
  urgency: Urgency;
  page: number;
  quote: string;
}

const TEMPLATES: Omit<Item, 'doc' | 'folderPath'>[] = [
  { text: 'Pay the premium', when: 'Due 3 days ago', urgency: 'overdue', page: 2, quote: 'Der Beitrag ist bis zum 18. fällig.' },
  { text: 'Send back signed form', when: 'Due in 4 days', urgency: 'soon', page: 1, quote: 'Bitte senden Sie das unterschriebene Formular zurück.' },
  { text: 'Cancel before notice period ends', when: 'By 30 Nov (3 months notice)', urgency: 'later', page: 4, quote: 'Kündigungsfrist drei Monate zum Jahresende.' },
  { text: 'Report meter reading', when: 'Every year, 1 Dec', urgency: 'later', page: 3, quote: 'Zählerstand jährlich zum 1. Dezember melden.' },
  { text: 'Check your contact details are correct', when: 'No date', urgency: 'undated', page: 1, quote: 'Bitte prüfen Sie Ihre Angaben.' },
];

const ORDER: Urgency[] = ['overdue', 'soon', 'later', 'undated'];
const LABEL: Record<Urgency, string> = {
  overdue: 'Overdue',
  soon: 'This week',
  later: 'Later',
  undated: 'No date',
};

function hash(s: string): number {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

@Component({
  selector: 'app-attention-prototype',
  template: `
    @if (variant(); as v) {
      <div class="proto-controls">
        <strong>PROTOTYPE {{ v }}</strong>
        <label>Scope
          <select (change)="scope.set($any($event.target).value)">
            <option value="deep" [selected]="scope() === 'deep'">Deep (subfolders)</option>
            <option value="direct" [selected]="scope() === 'direct'">Direct only</option>
          </select>
        </label>
        <label>Data
          <select (change)="mode.set($any($event.target).value)">
            <option value="normal" [selected]="mode() === 'normal'">Items</option>
            <option value="empty" [selected]="mode() === 'empty'">None needed</option>
            <option value="loading" [selected]="mode() === 'loading'">Loading</option>
          </select>
        </label>
      </div>

      @switch (v) {
        @case ('A') {
          <section class="panel">
            <button type="button" class="panel-head" (click)="open.set(!open())">
              <span class="chev">{{ open() ? '▾' : '▸' }}</span>
              <strong>Needs your attention</strong>
              @if (mode() === 'normal') { <span class="count">{{ items().length }}</span> }
            </button>
            @if (open()) {
              @if (mode() === 'loading') {
                <p class="muted pad">Reading 3 of 8 documents… <span class="spin"></span></p>
              } @else if (items().length === 0) {
                <p class="muted pad">✓ Nothing needs your attention in this folder.</p>
              } @else {
                @for (g of byUrgency(); track g.urgency) {
                  <h4 [class]="'grp ' + g.urgency">{{ g.label }} · {{ g.items.length }}</h4>
                  @for (i of g.items; track $index) {
                    <button type="button" class="row" (click)="go(i)">
                      <span class="dot {{ i.urgency }}"></span>
                      <span class="main">
                        <span class="t">{{ i.text }}</span>
                        <span class="sub">{{ i.doc.title }} · p.{{ i.page }}
                          @if (scope() === 'deep' && i.folderPath) { <em class="chip">{{ i.folderPath }}</em> }
                        </span>
                      </span>
                      <span class="when">{{ i.when }}</span>
                    </button>
                  }
                }
              }
            }
          </section>
        }
        @case ('B') {
          <div class="gridB">
            @for (f of store.visibleFolders(); track f.id) {
              <button type="button" class="cardB folder" (click)="openDoc.openFolder(f.id)">
                <span class="name">📁 {{ f.name }}</span>
                @if (mode() === 'normal' && folderCount(f.id) > 0) {
                  <span class="badge">{{ folderCount(f.id) }} need attention</span>
                }
              </button>
            }
            @for (d of store.visible() ?? []; track d.id) {
              <div class="cardB" [class.expanded]="expanded() === d.id">
                <button type="button" class="name" (click)="store.open(d.id)">{{ d.title }}</button>
                @if (mode() === 'loading') {
                  <span class="muted"><span class="spin"></span> analysing…</span>
                } @else if (mode() === 'normal' && itemsFor(d).length > 0) {
                  <button type="button" class="badge" (click)="expanded.set(expanded() === d.id ? null : d.id)">
                    ⚑ {{ itemsFor(d).length }} {{ expanded() === d.id ? '▾' : '▸' }}
                  </button>
                  @if (expanded() === d.id) {
                    @for (i of itemsFor(d); track $index) {
                      <button type="button" class="mini" (click)="go(i)">
                        <span class="dot {{ i.urgency }}"></span>{{ i.text }}
                        <span class="muted"> · {{ i.when }}</span>
                      </button>
                    }
                  }
                }
              </div>
            }
          </div>
        }
        @case ('C') {
          <button type="button" class="fab" (click)="drawer.set(true)">
            ⚑ Attention
            @if (mode() === 'normal') { <span class="count">{{ items().length }}</span> }
            @if (mode() === 'loading') { <span class="spin"></span> }
          </button>
          @if (drawer()) {
            <div class="scrim" (click)="drawer.set(false)"></div>
            <aside class="drawer">
              <header><strong>Needs your attention</strong>
                <button type="button" (click)="drawer.set(false)">✕</button></header>
              @if (mode() === 'loading') {
                <p class="muted pad">Reading documents… <span class="spin"></span></p>
              } @else if (byDoc().length === 0) {
                <p class="muted pad">✓ All clear.</p>
              } @else {
                @for (g of byDoc(); track g.doc.id) {
                  <h4 class="grp"><button type="button" (click)="store.open(g.doc.id)">{{ g.doc.title }}</button>
                    @if (scope() === 'deep' && g.items[0].folderPath) { <em class="chip">{{ g.items[0].folderPath }}</em> }
                  </h4>
                  @for (i of g.items; track $index) {
                    <button type="button" class="row" (click)="go(i)">
                      <span class="dot {{ i.urgency }}"></span>
                      <span class="main"><span class="t">{{ i.text }}</span><span class="sub">“{{ i.quote }}” · p.{{ i.page }}</span></span>
                      <span class="when">{{ i.when }}</span>
                    </button>
                  }
                }
              }
            </aside>
          }
        }
      }

      <div class="switcher" role="group" aria-label="Prototype variant">
        <button type="button" (click)="cycle(-1)">←</button>
        <span>{{ v }} ({{ names[v] }})</span>
        <button type="button" (click)="cycle(1)">→</button>
      </div>
    }
  `,
  host: { '(document:keydown)': 'onKey($event)' },
  styles: `
    :host { display: block; font-size: 13px; }
    .proto-controls { display: flex; gap: 12px; align-items: center; margin: 8px 0; padding: 6px 10px; background: #fff7d6; border: 1px dashed #c9a400; border-radius: 8px; }
    .muted { color: #777; } .pad { padding: 10px 14px; margin: 0; }
    .spin { display: inline-block; width: 10px; height: 10px; border: 2px solid #bbb; border-top-color: #333; border-radius: 50%; animation: s 0.8s linear infinite; }
    @keyframes s { to { transform: rotate(360deg); } }
    button { font: inherit; cursor: pointer; }
    .count { background: #d93025; color: #fff; border-radius: 10px; padding: 0 7px; font-size: 11px; margin-left: 6px; }
    .dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; background: #999; }
    .dot.overdue { background: #d93025; } .dot.soon { background: #f29900; } .dot.later { background: #1a73e8; }
    .chip { font-style: normal; background: #eef; border-radius: 8px; padding: 1px 7px; margin-left: 4px; font-size: 11px; }
    .row { display: flex; gap: 10px; align-items: center; width: 100%; text-align: left; padding: 8px 14px; border: 0; background: transparent; border-top: 1px solid #eee; }
    .row:hover, .mini:hover { background: #f3f7ff; }
    .main { flex: 1; display: flex; flex-direction: column; min-width: 0; }
    .t { font-weight: 600; } .sub { color: #666; font-size: 12px; } .when { color: #555; font-size: 12px; white-space: nowrap; }
    .grp { margin: 0; padding: 6px 14px; background: #fafafa; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
    .grp.overdue { color: #d93025; }
    .grp button { border: 0; background: none; font-weight: 700; text-decoration: underline; padding: 0; text-transform: none; font-size: 13px; }
    /* A */
    .panel { border: 1px solid #ddd; border-radius: 10px; background: #fff; margin: 8px 0 4px; overflow: hidden; }
    .panel-head { display: flex; align-items: center; gap: 8px; width: 100%; padding: 10px 14px; border: 0; background: #fff8f7; }
    /* B */
    .gridB { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 8px; margin-top: 12px; align-items: start; }
    .cardB { display: flex; flex-direction: column; gap: 6px; padding: 12px; border: 1px solid #ddd; border-radius: 10px; background: #fff; text-align: left; min-height: 86px; }
    .cardB.expanded { grid-column: span 2; }
    .cardB .name { border: 0; background: none; font-weight: 600; text-align: left; padding: 0; }
    .badge { align-self: flex-start; border: 0; background: #fde7e5; color: #b3261e; border-radius: 10px; padding: 2px 9px; font-size: 12px; }
    .mini { display: flex; align-items: center; gap: 6px; border: 0; background: none; text-align: left; padding: 4px; border-radius: 6px; }
    /* C */
    .fab { position: fixed; top: 14px; right: 20px; z-index: 40; padding: 6px 12px; border-radius: 16px; border: 1px solid #ccc; background: #fff; }
    .scrim { position: fixed; inset: 0; background: #0005; z-index: 50; }
    .drawer { position: fixed; top: 0; right: 0; bottom: 0; width: min(420px, 100%); background: #fff; z-index: 60; overflow-y: auto; box-shadow: -4px 0 20px #0003; }
    .drawer header { display: flex; justify-content: space-between; padding: 14px; border-bottom: 1px solid #eee; }
    .drawer header button { border: 0; background: none; }
    /* switcher */
    .switcher { position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%); z-index: 100; display: flex; gap: 12px; align-items: center; background: #111; color: #fff; padding: 8px 14px; border-radius: 22px; box-shadow: 0 4px 16px #0006; }
    .switcher button { background: #333; color: #fff; border: 0; border-radius: 50%; width: 26px; height: 26px; }
  `,
})
export class AttentionPrototype {
  protected readonly store = inject(LibraryStore);
  protected readonly openDoc = inject(OpenDocument);
  protected readonly names = NAMES;
  protected readonly variant = attentionVariant;
  protected readonly scope = signal<'deep' | 'direct'>('deep');
  protected readonly mode = signal<'normal' | 'empty' | 'loading'>('normal');
  protected readonly open = signal(true);
  protected readonly drawer = signal(false);
  protected readonly expanded = signal<string | null>(null);

  private pathOf(doc: DocumentRecord): string {
    const base = this.openDoc.folderId();
    const chain = folderAncestry(this.store.folders() ?? [], doc.folderId);
    const from = base === null ? 0 : chain.findIndex((f) => f.id === base) + 1;
    return chain.slice(from).map((f) => f.name).join(' / ');
  }

  protected itemsFor(doc: DocumentRecord): Item[] {
    if (this.mode() === 'empty' || doc.status !== 'ready') return [];
    const h = hash(doc.id);
    const n = [0, 1, 2, 3][h % 4];
    const folderPath = this.pathOf(doc);
    return Array.from({ length: n }, (_, k) => ({
      ...TEMPLATES[(h + k) % TEMPLATES.length],
      doc,
      folderPath,
    }));
  }

  private inScope(doc: DocumentRecord): boolean {
    const base = this.openDoc.folderId();
    if (this.scope() === 'direct') return doc.folderId === base;
    if (base === null) return true;
    return folderAncestry(this.store.folders() ?? [], doc.folderId).some((f) => f.id === base);
  }

  protected readonly items = computed(() =>
    (this.store.documents() ?? []).filter((d) => this.inScope(d)).flatMap((d) => this.itemsFor(d)),
  );

  protected readonly byUrgency = computed(() =>
    ORDER.map((urgency) => ({
      urgency,
      label: LABEL[urgency],
      items: this.items().filter((i) => i.urgency === urgency),
    })).filter((g) => g.items.length > 0),
  );

  protected readonly byDoc = computed(() => {
    const groups = new Map<string, { doc: DocumentRecord; items: Item[] }>();
    for (const i of this.items()) {
      (groups.get(i.doc.id) ?? groups.set(i.doc.id, { doc: i.doc, items: [] }).get(i.doc.id)!).items.push(i);
    }
    return [...groups.values()];
  });

  protected folderCount(folderId: string): number {
    const ids = new Set<string>();
    const walk = (id: string) => {
      ids.add(id);
      (this.store.folders() ?? []).filter((f) => f.parentId === id).forEach((f) => walk(f.id));
    };
    walk(folderId);
    return (this.store.documents() ?? [])
      .filter((d) => d.folderId !== null && ids.has(d.folderId))
      .reduce((sum, d) => sum + this.itemsFor(d).length, 0);
  }

  protected go(item: Item): void {
    this.drawer.set(false);
    this.store.open(item.doc.id);
  }

  protected cycle(delta: number): void {
    const cur = VARIANTS.indexOf(this.variant() ?? 'A');
    const next = VARIANTS[(cur + delta + VARIANTS.length) % VARIANTS.length];
    this.variant.set(next);
    const url = new URL(location.href);
    url.searchParams.set('variant', next);
    history.replaceState(history.state, '', url);
  }

  protected onKey(e: KeyboardEvent): void {
    const t = e.target as HTMLElement;
    if (!this.variant() || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable) return;
    if (e.key === 'ArrowLeft') this.cycle(-1);
    if (e.key === 'ArrowRight') this.cycle(1);
  }
}
