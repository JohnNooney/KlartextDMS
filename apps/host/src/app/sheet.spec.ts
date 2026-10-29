import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { Sheet, type SheetDetent } from './sheet';
import { SheetHandle } from './sheet-handle';
import {
  sheetDetent,
  sheetHandle as handle,
  sheetPointer as pointer,
  sheetTap as tap,
} from './sheet.spec-support';

// The attention sheet's future detent set (issue #152, ADR 0014): two
// heights, no peek — the smallest is half the viewport.
const TWO_DETENTS: readonly SheetDetent[] = [
  { name: 'medium', height: ({ viewportHeight }) => viewportHeight * 0.5 },
  { name: 'large', height: ({ viewportHeight }) => viewportHeight },
];

@Component({
  template: `
    <div
      class="test-sheet"
      appSheet
      [detents]="detents"
      [(detent)]="detent"
      [dismissible]="dismissible()"
      (dismissRequested)="dismissCount.set(dismissCount() + 1)"
    >
      <button appSheetHandle [label]="label()"></button>
      <div class="sheet-body"></div>
    </div>
  `,
  imports: [Sheet, SheetHandle],
})
class TestSheet {
  readonly detents = TWO_DETENTS;
  readonly detent = signal('medium');
  readonly dismissible = signal(false);
  readonly dismissCount = signal(0);
  readonly label = signal('Resize sheet');
}

async function setup() {
  await TestBed.configureTestingModule({ imports: [TestSheet] }).compileComponents();
  const fixture = TestBed.createComponent(TestSheet);
  fixture.detectChanges();
  return {
    fixture,
    host: fixture.componentInstance,
    el: fixture.nativeElement as HTMLElement,
  };
}

function sheet(el: HTMLElement): HTMLElement {
  return el.querySelector<HTMLElement>('.test-sheet')!;
}

function detent(el: HTMLElement): string | null {
  return sheetDetent(sheet(el));
}

describe('Sheet primitive (issue #152)', () => {
  it('rests on its smallest detent — the handle is a real labelled button', async () => {
    const { el } = await setup();
    expect(detent(el)).toBe('medium');

    const button = handle(el);
    expect(button.tagName).toBe('BUTTON');
    expect(button.getAttribute('type')).toBe('button');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.getAttribute('aria-label')).toBe('Resize sheet');
    // The 36×5 grabber pill is the drag affordance — no directional glyph.
    expect(button.querySelector('.handle-pill')).not.toBeNull();
    expect(button.querySelector('svg')).toBeNull();
  });

  it('the handle cycles through the configured detents and wraps', async () => {
    const { fixture, el } = await setup();
    tap(fixture, el);
    expect(detent(el)).toBe('large');
    expect(handle(el).getAttribute('aria-expanded')).toBe('true');

    tap(fixture, el);
    expect(detent(el)).toBe('medium');
    expect(handle(el).getAttribute('aria-expanded')).toBe('false');
  });

  it('a drag tracks the finger, then snaps to the nearest detent on release', async () => {
    const { fixture, el } = await setup();
    const vh = window.innerHeight;
    const host = sheet(el);

    // Press at the medium height, drag until the sheet stands near large.
    pointer(el, 'pointerdown', vh * 0.5, 0);
    pointer(el, 'pointermove', vh * 0.125, 1000);
    expect(host.classList.contains('is-dragging')).toBe(true);
    expect(host.style.height).toBe(`${vh * 0.875}px`);

    pointer(el, 'pointerup', vh * 0.125, 1050);
    expect(detent(el)).toBe('large');
    expect(host.style.height).toBe('');
    expect(host.classList.contains('is-dragging')).toBe(false);

    // The click the release still fires must not cycle on top of the snap.
    handle(el).click();
    fixture.detectChanges();
    expect(detent(el)).toBe('large');
  });

  it('a fast flick moves one detent in the flick direction', async () => {
    const { el } = await setup();
    const vh = window.innerHeight;

    // Released nearer medium — but the upward flick overrides position.
    pointer(el, 'pointerdown', vh * 0.5, 0);
    pointer(el, 'pointermove', vh * 0.45, 10);
    pointer(el, 'pointerup', vh * 0.4, 20);
    expect(detent(el)).toBe('large');
  });

  it('a held-then-released finger is no flick — stale velocity decays', async () => {
    const { el } = await setup();
    const vh = window.innerHeight;

    // A fast upward move long before release must not ride in as a flick.
    pointer(el, 'pointerdown', vh * 0.5, 0);
    pointer(el, 'pointermove', vh * 0.45, 10);
    pointer(el, 'pointerup', vh * 0.45, 500);
    expect(detent(el)).toBe('medium');
  });

  it('a wobble under the drag threshold still taps through', async () => {
    const { fixture, el } = await setup();
    const vh = window.innerHeight;

    pointer(el, 'pointerdown', vh * 0.5, 0);
    pointer(el, 'pointermove', vh * 0.5 + 3, 100);
    pointer(el, 'pointerup', vh * 0.5 + 3, 150);
    tap(fixture, el);
    expect(detent(el)).toBe('large');
  });

  it('a non-dismissible sheet snaps to the smallest detent instead of closing', async () => {
    const { el, host } = await setup();
    const vh = window.innerHeight;

    pointer(el, 'pointerdown', vh * 0.5, 0);
    pointer(el, 'pointermove', vh * 0.9, 1000);
    pointer(el, 'pointerup', vh * 0.9, 1050);
    expect(detent(el)).toBe('medium');
    expect(host.dismissCount()).toBe(0);
  });

  it('a dismissible sheet asks to dismiss when released below its smallest detent', async () => {
    const { fixture, el, host } = await setup();
    host.dismissible.set(true);
    fixture.detectChanges();
    const vh = window.innerHeight;
    const sheetEl = sheet(el);

    pointer(el, 'pointerdown', vh * 0.5, 0);
    pointer(el, 'pointermove', vh * 0.9, 1000);
    pointer(el, 'pointerup', vh * 0.9, 1050);

    // A request, not an action — the detent stands until the consumer closes.
    expect(host.dismissCount()).toBe(1);
    expect(detent(el)).toBe('medium');
    expect(sheetEl.style.height).toBe('');
    expect(sheetEl.classList.contains('is-dragging')).toBe(false);
  });

  it('a downward flick at the smallest detent asks to dismiss', async () => {
    const { fixture, el, host } = await setup();
    host.dismissible.set(true);
    fixture.detectChanges();
    const vh = window.innerHeight;

    // Released above medium's floor but flicking down fast — the flick
    // carries the sheet past its last rung.
    pointer(el, 'pointerdown', vh * 0.5, 0);
    pointer(el, 'pointermove', vh * 0.55, 10);
    pointer(el, 'pointerup', vh * 0.6, 20);
    expect(host.dismissCount()).toBe(1);
    expect(detent(el)).toBe('medium');
  });

  it('an upward flick from below the smallest detent still snaps back', async () => {
    const { fixture, el, host } = await setup();
    host.dismissible.set(true);
    fixture.detectChanges();
    const vh = window.innerHeight;

    // Dragged deep past medium's floor, then flicked up on release — the
    // flick overrides position and carries the sheet a rung above nearest.
    pointer(el, 'pointerdown', vh * 0.5, 0);
    pointer(el, 'pointermove', vh * 0.9, 10);
    pointer(el, 'pointermove', vh * 0.6, 15);
    pointer(el, 'pointermove', vh * 0.55, 20);
    pointer(el, 'pointerup', vh * 0.55, 25);
    expect(host.dismissCount()).toBe(0);
    expect(detent(el)).toBe('large');
  });
});
