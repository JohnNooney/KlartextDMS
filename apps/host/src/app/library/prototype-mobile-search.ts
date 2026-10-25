/**
 * PROTOTYPE — throwaway, do not ship. Three radically different mobile
 * toolbar+search chromes for the library (issue #121 follow-up), mounted in
 * place of the real toolbar on the existing route and switchable from the
 * floating bottom bar. The selection lives in localStorage
 * (`klartext-proto-search`) — `?q=`/`?scope=` already own the route's query
 * params, so a `?variant=` param would be dropped by `search()`'s writes.
 *
 *   A "Title swap" — the magnifier swaps the title for the field in place;
 *      no extra row is ever consumed.
 *   B "Overlay"    — the magnifier drops a floating bar and tap-away scrim
 *      over the content; the toolbar itself never changes.
 *   C "Dock"       — a slim always-on field pinned near the bottom edge; the
 *      toolbar keeps only title + count + add.
 *
 * Every variant collapses on Folder navigation and on blur with an empty
 * field — the stuck `.search-open` state this prototype exists to answer.
 * Declutter (all variants): the count moves into the title, the meta line
 * hides, the attention card tightens, and the app header's user name drops.
 */

import { NgTemplateOutlet } from '@angular/common';
import {
  Component,
  computed,
  effect,
  ElementRef,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';

export type ProtoVariant = 'a' | 'b' | 'c' | null;
export const PROTO_VARIANT_KEY = 'klartext-proto-search';

/** Page-level declutter injected while a variant is mounted (mobile only). */
const PAGE_CSS = `
  @media (max-width: 768px) {
    .meta-line { display: none; }
    .toolbar .user-name { display: none; }
    .attention { padding-top: 4px; padding-bottom: 4px; }
    .attention-head { padding: 4px 8px; }
  }
`;

/* eslint-disable @typescript-eslint/no-explicit-any */

@Component({
  selector: 'app-proto-chrome',
  template: `
    <header class="proto-toolbar">
      @if (ctx().backTarget() !== undefined) {
        <button type="button" class="p-back" (click)="ctx().back()" [attr.aria-label]="'Back to ' + ctx().backLabel()">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 5.5 8 12l6.5 6.5"/></svg>
          <span>{{ ctx().backLabel() }}</span>
        </button>
      }
      @switch (variant()) {
        @case ('a') {
          @if (showField()) {
            <div class="p-field" role="search">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4.2-4.2"/></svg>
              <input #box type="search" placeholder="Search" aria-label="Search the library" (input)="onInput($event)" (blur)="maybeClose()" (keydown.escape)="escape()" />
              @if (ctx().searching() && ctx().openDocument.folderId() !== null) {
                <ng-container *ngTemplateOutlet="pill"></ng-container>
              }
              <button type="button" class="p-x" (click)="clear()" aria-label="Clear or close search">✕</button>
            </div>
            <button type="button" class="p-iconbtn p-add" (click)="ctx().toggleAddMenu()" aria-label="Add">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M12 6v12M6 12h12"/></svg>
            </button>
          } @else {
            <h1 class="p-title" lang="de">{{ ctx().title() }}</h1>
            <span class="p-count">{{ ctx().store.deepDocumentCount() }}</span>
            <span class="p-spacer"></span>
            <button type="button" class="p-iconbtn" (click)="reveal()" aria-label="Search">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4.2-4.2"/></svg>
            </button>
            <button type="button" class="p-iconbtn p-add" (click)="ctx().toggleAddMenu()" aria-label="Add">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M12 6v12M6 12h12"/></svg>
            </button>
          }
        }
        @case ('b') {
          <h1 class="p-title" lang="de">{{ ctx().title() }}</h1>
          <span class="p-count">{{ ctx().store.deepDocumentCount() }}</span>
          <span class="p-spacer"></span>
          <button type="button" class="p-iconbtn" (click)="reveal()" aria-label="Search">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4.2-4.2"/></svg>
          </button>
          <button type="button" class="p-iconbtn p-add" (click)="ctx().toggleAddMenu()" aria-label="Add">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M12 6v12M6 12h12"/></svg>
          </button>
        }
        @case ('c') {
          <h1 class="p-title" lang="de">{{ ctx().title() }}</h1>
          <span class="p-count">{{ ctx().store.deepDocumentCount() }}</span>
          <span class="p-spacer"></span>
          <button type="button" class="p-iconbtn p-add" (click)="ctx().toggleAddMenu()" aria-label="Add">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M12 6v12M6 12h12"/></svg>
          </button>
        }
      }
    </header>

    @if (variant() === 'b' && showField()) {
      <button type="button" class="p-scrim" (click)="close()" aria-label="Dismiss search" tabindex="-1"></button>
      <div class="p-sheet" role="search">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4.2-4.2"/></svg>
        <input #box type="search" placeholder="Search" aria-label="Search the library" (input)="onInput($event)" (blur)="maybeClose()" (keydown.escape)="escape()" />
        @if (ctx().searching() && ctx().openDocument.folderId() !== null) {
          <ng-container *ngTemplateOutlet="pill"></ng-container>
        }
        <button type="button" class="p-x" (click)="clear()" aria-label="Clear or close search">✕</button>
      </div>
    }

    @if (variant() === 'c') {
      <div class="p-dock" role="search">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4.2-4.2"/></svg>
        <input #box type="search" placeholder="Search" aria-label="Search the library" (input)="onInput($event)" (keydown.escape)="escape()" />
        @if (ctx().searching() && ctx().openDocument.folderId() !== null) {
          <ng-container *ngTemplateOutlet="pill"></ng-container>
        }
        @if (ctx().searching()) {
          <button type="button" class="p-x" (click)="clear()" aria-label="Clear search">✕</button>
        }
      </div>
    }

    @if (ctx().addMenuOpen()) {
      <button type="button" class="p-menushield" (click)="ctx().closeAddMenu()" aria-hidden="true" tabindex="-1"></button>
      <div class="p-menu" role="menu" aria-label="Add">
        <button type="button" role="menuitem" (click)="ctx().pickAdd('upload')">Upload document</button>
        <button type="button" role="menuitem" (click)="ctx().pickAdd('new-folder')">New folder</button>
      </div>
    }

    <ng-template #pill>
      <span class="p-pill" role="group" aria-label="Search scope">
        <button type="button" [class.on]="ctx().openDocument.searchScope() === 'folder'" (click)="ctx().openDocument.setSearchScope('folder')">This folder</button>
        <button type="button" [class.on]="ctx().openDocument.searchScope() === 'all'" (click)="ctx().openDocument.setSearchScope('all')">All documents</button>
      </span>
    </ng-template>
  `,
  styles: `
    :host { display: contents; }
    .proto-toolbar {
      min-height: 56px; display: flex; align-items: center; gap: 10px;
      padding: 8px 16px; flex-shrink: 0;
    }
    .p-back {
      display: inline-flex; align-items: center; height: 36px; padding: 0 8px 0 0;
      border: 0; background: transparent; color: var(--kt-accent); font-size: 15px; gap: 2px;
    }
    .p-title { margin: 0; font-size: 22px; font-weight: 700; letter-spacing: -0.01em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .p-count { font-size: 12px; color: var(--kt-text-faint); margin-left: 2px; flex-shrink: 0; }
    .p-spacer { flex: 1; }
    .p-iconbtn {
      display: grid; place-items: center; width: 40px; height: 40px; border: 0;
      border-radius: 50%; background: var(--kt-accent-tint); color: var(--kt-accent); cursor: pointer; flex-shrink: 0;
    }
    .p-add { background: var(--kt-fill-strong); color: var(--kt-text-muted); }
    .p-field, .p-sheet, .p-dock {
      display: flex; align-items: center; gap: 8px; min-width: 0;
      height: 40px; padding: 0 8px 0 14px; border-radius: 999px;
      background: var(--kt-fill); color: var(--kt-text-muted);
    }
    .p-field { flex: 1; }
    .p-field input, .p-sheet input, .p-dock input {
      flex: 1; min-width: 0; border: 0; background: transparent; font: inherit;
      font-size: 15px; color: var(--kt-text); outline: none;
    }
    input::-webkit-search-cancel-button { display: none; }
    .p-x {
      display: grid; place-items: center; width: 24px; height: 24px; border: 0;
      border-radius: 50%; background: var(--kt-fill-strong); color: var(--kt-text-muted);
      cursor: pointer; flex-shrink: 0; font-size: 11px;
    }
    .p-pill { display: flex; padding: 2px; border-radius: 999px; background: var(--kt-fill-strong); flex-shrink: 0; }
    .p-pill button { border: 0; border-radius: 999px; padding: 3px 10px; background: transparent; font: inherit; font-size: 12px; color: var(--kt-text-muted); cursor: pointer; white-space: nowrap; }
    .p-pill button.on { background: var(--kt-bg); color: var(--kt-text); box-shadow: 0 1px 3px rgb(0 0 0 / 0.12); }
    .p-scrim {
      position: fixed; inset: 0; z-index: 40; border: 0; padding: 0;
      background: rgb(0 0 0 / 0.18); cursor: default;
    }
    .p-sheet {
      position: fixed; top: 112px; left: 16px; right: 16px; z-index: 41;
      background: var(--kt-bg); box-shadow: 0 8px 24px rgb(0 0 0 / 0.18);
      animation: proto-drop 140ms ease-out;
    }
    @keyframes proto-drop { from { transform: translateY(-6px); opacity: 0; } }
    .p-dock {
      position: fixed; left: 16px; right: 16px; bottom: 72px; z-index: 30;
      background: var(--kt-bg); border: 1px solid var(--kt-border);
      box-shadow: 0 4px 16px rgb(0 0 0 / 0.10);
    }
    .p-menushield { position: fixed; inset: 0; z-index: 45; border: 0; background: transparent; }
    .p-menu {
      position: absolute; top: 52px; right: 16px; z-index: 46; display: flex;
      flex-direction: column; min-width: 180px; padding: 6px; border-radius: 12px;
      background: var(--kt-bg); box-shadow: 0 8px 24px rgb(0 0 0 / 0.16);
    }
    .p-menu button { border: 0; background: transparent; padding: 10px 12px; text-align: left; font: inherit; font-size: 14px; border-radius: 8px; cursor: pointer; }
    .p-menu button:hover { background: var(--kt-fill); }
  `,
  imports: [NgTemplateOutlet],
})
export class ProtoChrome {
  readonly variant = input.required<Exclude<ProtoVariant, null>>();
  /** The Library instance, loosely typed — this is throwaway wiring. */
  readonly ctx = input.required<any>();
  protected readonly open = signal(false);
  protected readonly showField = computed(() => this.open() || this.ctx().searching());
  private readonly box = viewChild<ElementRef<HTMLInputElement>>('box');

  constructor() {
    // Collapse on Folder/Document navigation — the stuck-open fix.
    effect(() => {
      this.ctx().openDocument.folderId();
      this.ctx().openDocument.docId();
      this.open.set(false);
    });
    // Page declutter lives only while a variant is mounted.
    effect((onCleanup) => {
      const style = document.createElement('style');
      style.textContent = PAGE_CSS;
      document.head.appendChild(style);
      onCleanup(() => style.remove());
    });
    // A deep-linked query restores the field's text.
    effect(() => {
      const el = this.box()?.nativeElement;
      if (el && el.value !== this.ctx().query()) el.value = this.ctx().query();
    });
  }

  protected reveal(): void {
    this.open.set(true);
    setTimeout(() => this.box()?.nativeElement.focus());
  }

  protected maybeClose(): void {
    setTimeout(() => {
      if (!this.ctx().searching()) this.open.set(false);
    }, 150);
  }

  /** Escape clears the query and collapses; ✕ does the same. */
  protected escape(): void {
    this.ctx().openDocument.search('');
    this.open.set(false);
  }

  protected clear(): void {
    this.ctx().openDocument.search('');
    this.open.set(false);
  }

  /** The overlay's scrim — dismiss restores the Folder view. */
  protected close(): void {
    this.clear();
  }

  protected onInput(event: Event): void {
    this.ctx().onSearchInput(event);
  }
}

@Component({
  selector: 'app-proto-switcher',
  template: `
    <div class="sw">
      <button type="button" (click)="step(-1)" aria-label="Previous variant">◀</button>
      <span class="sw-label">{{ label() }}</span>
      <button type="button" (click)="step(1)" aria-label="Next variant">▶</button>
    </div>
  `,
  styles: `
    :host { position: fixed; left: 50%; bottom: 16px; transform: translateX(-50%); z-index: 100; }
    .sw {
      display: flex; align-items: center; gap: 10px; padding: 6px 10px;
      border-radius: 999px; background: #1c1c1e; color: #fff;
      box-shadow: 0 4px 16px rgb(0 0 0 / 0.3); font-family: monospace;
    }
    .sw button { border: 0; background: transparent; color: #fff; font-size: 14px; cursor: pointer; padding: 4px 8px; }
    .sw-label { font-size: 12px; min-width: 120px; text-align: center; }
  `,
  host: { '(document:keydown)': 'onKey($event)' },
})
export class ProtoSwitcher {
  readonly value = input<ProtoVariant>(null);
  readonly changed = output<ProtoVariant>();
  private readonly order: ProtoVariant[] = [null, 'a', 'b', 'c'];
  private readonly names: Record<string, string> = {
    a: 'A · Title swap',
    b: 'B · Overlay',
    c: 'C · Bottom dock',
  };
  protected readonly label = computed(() =>
    this.value() === null ? 'off (production)' : this.names[this.value()!],
  );

  protected step(dir: 1 | -1): void {
    const i = this.order.indexOf(this.value());
    this.changed.emit(this.order[(i + dir + this.order.length) % this.order.length]);
  }

  protected onKey(event: KeyboardEvent): void {
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
    ) {
      return;
    }
    if (event.key === 'ArrowLeft') this.step(-1);
    else if (event.key === 'ArrowRight') this.step(1);
  }
}
