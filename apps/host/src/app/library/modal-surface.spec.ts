import { Component, signal, type Type } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { ModalSurface } from './modal-surface';
import {
  FakeVisualViewport,
  restoreVisualViewport,
  useVisualViewport,
} from '../visual-viewport.spec-support';

/** A page button behind the surface plus one open surface with three controls. */
@Component({
  template: `
    <button type="button" class="trigger">trigger</button>
    @if (open()) {
      <div class="surface" appModalSurface (closeRequested)="requests.set(requests() + 1)">
        <button type="button" class="first">first</button>
        <input type="text" />
        <button type="button" class="last">last</button>
      </div>
    }
  `,
  imports: [ModalSurface],
})
class SurfaceHost {
  readonly open = signal(true);
  readonly requests = signal(0);
}

/** The attention "See All" surface — tracking and the trap apply to `.sheet` too. */
@Component({
  template: `
    <div class="sheet" appModalSurface (closeRequested)="requests.set(requests() + 1)">
      <button type="button" class="first">first</button>
    </div>
  `,
  imports: [ModalSurface],
})
class SheetHost {
  readonly requests = signal(0);
}

/** A surface whose own stylesheet cap is tighter than the viewport margin. */
@Component({
  template: `
    <div class="surface capped" appModalSurface>
      <button type="button">control</button>
    </div>
  `,
  imports: [ModalSurface],
})
class CappedHost {}

/** A surface with nothing focusable — it takes focus itself. */
@Component({
  template: `<div class="surface" appModalSurface><p>text only</p></div>`,
  imports: [ModalSurface],
})
class EmptyHost {}

/** A surface marking one control autofocus — focus lands there, not the first. */
@Component({
  template: `
    <div class="surface" appModalSurface>
      <button type="button" class="first">first</button>
      <input type="text" class="field" autofocus />
    </div>
  `,
  imports: [ModalSurface],
})
class AutofocusHost {}

/** A launcher that destroys itself while opening the surface — the ⋮ menu pattern. */
@Component({
  template: `
    <button type="button" class="trigger">trigger</button>
    @if (menuItem()) {
      <button type="button" class="menu-item" (click)="menuItem.set(false); open.set(true)">
        item
      </button>
    }
    @if (open()) {
      <div class="surface" appModalSurface>
        <button type="button">inside</button>
      </div>
    }
  `,
  imports: [ModalSurface],
})
class LauncherHost {
  readonly menuItem = signal(true);
  readonly open = signal(false);
}

/** Two surfaces in the page — the second one to open sits on top. */
@Component({
  template: `
    <div class="a" appModalSurface (closeRequested)="aRequests.set(aRequests() + 1)">
      <button type="button">a</button>
    </div>
    @if (bOpen()) {
      <div class="b" appModalSurface (closeRequested)="bRequests.set(bRequests() + 1)">
        <button type="button">b</button>
      </div>
    }
  `,
  imports: [ModalSurface],
})
class StackedHost {
  readonly bOpen = signal(false);
  readonly aRequests = signal(0);
  readonly bRequests = signal(0);
}

const injectedStyles: HTMLStyleElement[] = [];

/** A real stylesheet rule — jsdom resolves document styles in getComputedStyle. */
function injectStyle(css: string): void {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
  injectedStyles.push(style);
}

/** The margin token tokens.css declares on :root — custom properties inherit
 *  to the surface in a real browser, but jsdom's getComputedStyle doesn't do
 *  inheritance, so the spec sets it inline. */
function useModalMargin(el: HTMLElement, px: number): void {
  el.style.setProperty('--kt-modal-margin', `${px}px`);
}

afterEach(() => {
  restoreVisualViewport();
  for (const style of injectedStyles.splice(0)) style.remove();
});

async function setup<T>(type: Type<T>): Promise<ComponentFixture<T>> {
  await TestBed.configureTestingModule({ imports: [type] }).compileComponents();
  const fixture = TestBed.createComponent(type);
  fixture.detectChanges();
  return fixture;
}

function surfaceOf(el: HTMLElement, selector = '.surface'): HTMLElement {
  return el.querySelector<HTMLElement>(selector)!;
}

function keydown(target: HTMLElement | Document, key: string, shiftKey = false): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

describe('ModalSurface — dismissal (issue #150)', () => {
  it('inserts a labelled backdrop whose click requests close', async () => {
    const fixture = await setup(SurfaceHost);
    const el = fixture.nativeElement as HTMLElement;
    const host = fixture.componentInstance;

    const backdrop = el.querySelector<HTMLButtonElement>('.backdrop');
    expect(backdrop).toBeTruthy();
    expect(backdrop!.getAttribute('aria-label')).toBe('Close');
    expect(backdrop!.tabIndex).toBe(-1);
    expect(backdrop!.nextElementSibling).toBe(surfaceOf(el));

    backdrop!.click();
    expect(host.requests()).toBe(1);
  });

  it('Escape requests close', async () => {
    const fixture = await setup(SurfaceHost);
    const host = fixture.componentInstance;

    keydown(document, 'Escape');
    expect(host.requests()).toBe(1);
  });

  it('Escape closes only the topmost of two stacked surfaces', async () => {
    const fixture = await setup(StackedHost);
    const host = fixture.componentInstance;

    host.bOpen.set(true);
    fixture.detectChanges();
    keydown(document, 'Escape');
    expect(host.bRequests()).toBe(1);
    expect(host.aRequests()).toBe(0);

    // Once the top surface is gone the one beneath answers Escape again.
    host.bOpen.set(false);
    fixture.detectChanges();
    keydown(document, 'Escape');
    expect(host.aRequests()).toBe(1);
  });

  it('a close request is only a request — the consumer decides (the Discard-changes hook)', async () => {
    const fixture = await setup(SurfaceHost);
    const host = fixture.componentInstance;

    // The host counts the request but keeps the surface open — a future
    // "Discard changes?" flow intercepts at exactly this point.
    keydown(document, 'Escape');
    expect(host.requests()).toBe(1);
    expect((fixture.nativeElement as HTMLElement).querySelector('.surface')).toBeTruthy();
  });
});

describe('ModalSurface — focus (issue #150)', () => {
  it('moves focus to the first focusable control on open', async () => {
    const fixture = await setup(SurfaceHost);
    expect(document.activeElement).toBe(surfaceOf(fixture.nativeElement).querySelector('.first'));
  });

  it('honours an autofocus control over the first one', async () => {
    const fixture = await setup(AutofocusHost);
    expect(document.activeElement).toBe(
      (fixture.nativeElement as HTMLElement).querySelector('.field'),
    );
  });

  it('focuses the surface itself when it holds no controls', async () => {
    const fixture = await setup(EmptyHost);
    const surface = surfaceOf(fixture.nativeElement);
    expect(surface.tabIndex).toBe(-1);
    expect(document.activeElement).toBe(surface);
  });

  it('Tab on the last control cycles to the first, Shift+Tab on the first to the last', async () => {
    const fixture = await setup(SurfaceHost);
    const surface = surfaceOf(fixture.nativeElement);
    const first = surface.querySelector<HTMLElement>('.first')!;
    const last = surface.querySelector<HTMLElement>('.last')!;

    last.focus();
    const forward = keydown(last, 'Tab');
    expect(forward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);

    const backward = keydown(first, 'Tab', true);
    expect(backward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);
  });

  it('lets Tab through untrapped mid-surface', async () => {
    const fixture = await setup(SurfaceHost);
    const surface = surfaceOf(fixture.nativeElement);
    const input = surface.querySelector<HTMLElement>('input')!;

    input.focus();
    const event = keydown(input, 'Tab');
    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(input);
  });

  it('pulls Tab back into the surface when focus reached the page behind', async () => {
    const fixture = await setup(SurfaceHost);
    const el = fixture.nativeElement as HTMLElement;
    const trigger = el.querySelector<HTMLElement>('.trigger')!;
    const first = surfaceOf(el).querySelector<HTMLElement>('.first')!;
    const last = surfaceOf(el).querySelector<HTMLElement>('.last')!;

    trigger.focus();
    keydown(trigger, 'Tab');
    expect(document.activeElement).toBe(first);

    trigger.focus();
    keydown(trigger, 'Tab', true);
    expect(document.activeElement).toBe(last);
  });

  it('returns focus to the element that opened the surface', async () => {
    const fixture = await setup(SurfaceHost);
    const el = fixture.nativeElement as HTMLElement;
    const host = fixture.componentInstance;
    const trigger = el.querySelector<HTMLElement>('.trigger')!;

    // Reopen so the trigger is the remembered focus owner.
    host.open.set(false);
    fixture.detectChanges();
    trigger.focus();
    host.open.set(true);
    fixture.detectChanges();
    expect(document.activeElement).not.toBe(trigger);

    host.open.set(false);
    fixture.detectChanges();
    expect(document.activeElement).toBe(trigger);
  });

  it('restores past a launcher destroyed while opening — the ⋮ menu path', async () => {
    const fixture = await setup(LauncherHost);
    const el = fixture.nativeElement as HTMLElement;
    const host = fixture.componentInstance;
    const trigger = el.querySelector<HTMLElement>('.trigger')!;
    const item = el.querySelector<HTMLElement>('.menu-item')!;

    trigger.focus();
    item.focus();
    item.click();
    fixture.detectChanges();
    // The item is gone, so the restore walk lands on the trigger before it.
    host.open.set(false);
    fixture.detectChanges();
    expect(document.activeElement).toBe(trigger);
  });

  it('pulls focus back to the topmost surface when it sits in a buried one', async () => {
    const fixture = await setup(StackedHost);
    const el = fixture.nativeElement as HTMLElement;
    const host = fixture.componentInstance;

    host.bOpen.set(true);
    fixture.detectChanges();
    const aFirst = el.querySelector<HTMLElement>('.a button')!;
    const bFirst = el.querySelector<HTMLElement>('.b button')!;
    // Focus stranded in the buried surface returns to the top one on Tab.
    aFirst.focus();
    const event = keydown(aFirst, 'Tab');
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(bFirst);
  });
});

describe('ModalSurface — visual viewport tracking (issue #64, #122, #150)', () => {
  it('centres the surface in the visual viewport and caps its height', async () => {
    const viewport = new FakeVisualViewport(800);
    useVisualViewport(viewport);
    const fixture = await setup(SurfaceHost);
    const surface = surfaceOf(fixture.nativeElement);
    useModalMargin(surface, 48);
    viewport.dispatchEvent(new Event('resize'));
    expect(surface.style.top).toBe('400px');
    expect(surface.style.maxHeight).toBe('752px');
  });

  it('applies the same tracking to a .sheet surface', async () => {
    const viewport = new FakeVisualViewport(800);
    useVisualViewport(viewport);
    const fixture = await setup(SheetHost);
    const sheet = surfaceOf(fixture.nativeElement, '.sheet');
    useModalMargin(sheet, 48);
    viewport.dispatchEvent(new Event('resize'));
    expect(sheet.style.top).toBe('400px');
    expect(sheet.style.maxHeight).toBe('752px');
  });

  it('follows the visual viewport as the on-screen keyboard shrinks it', async () => {
    const viewport = new FakeVisualViewport(800);
    useVisualViewport(viewport);
    const fixture = await setup(SurfaceHost);
    const surface = surfaceOf(fixture.nativeElement);
    useModalMargin(surface, 48);

    // Keyboard opens: the visible band shrinks and may pan (offsetTop).
    viewport.height = 360;
    viewport.offsetTop = 12;
    viewport.dispatchEvent(new Event('resize'));
    expect(surface.style.top).toBe('192px');
    expect(surface.style.maxHeight).toBe('312px');

    // Safari pans the visual viewport to reveal the focused field.
    viewport.offsetTop = 40;
    viewport.dispatchEvent(new Event('scroll'));
    expect(surface.style.top).toBe('220px');
  });

  it('leaves the stylesheet placement alone without a visualViewport', async () => {
    useVisualViewport(null);
    const fixture = await setup(SurfaceHost);
    const surface = surfaceOf(fixture.nativeElement);
    expect(surface.style.top).toBe('');
    expect(surface.style.maxHeight).toBe('');
  });

  it('keeps an edge-anchored surface anchored — it may fill the band', async () => {
    const viewport = new FakeVisualViewport(800);
    useVisualViewport(viewport);
    const fixture = await setup(SurfaceHost);
    const surface = surfaceOf(fixture.nativeElement);
    surface.style.bottom = '0';
    viewport.dispatchEvent(new Event('resize'));
    expect(surface.style.top).toBe('');
    expect(surface.style.maxHeight).toBe('800px');
  });

  it('never lifts the surface past its own stylesheet cap', async () => {
    injectStyle('.capped { max-height: 640px }');
    useVisualViewport(new FakeVisualViewport(800));
    const fixture = await setup(CappedHost);
    const surface = surfaceOf(fixture.nativeElement);
    expect(surface.style.maxHeight).toBe('640px');
  });
});
