import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MenuViewport } from './menu-viewport';

@Component({ template: '<div class="menu"></div>', imports: [MenuViewport] })
class HostWithMenu {}

class FakeVisualViewport extends EventTarget {
  constructor(
    public height: number,
    public offsetTop = 0,
  ) {
    super();
  }
}

let originalViewport: PropertyDescriptor | undefined;
let rectSpy: ReturnType<typeof vi.spyOn>;

/** Reports `bottom` for the .menu element, zeroed rects for everything else. */
function stubMenuBottom(bottom: number) {
  rectSpy = vi
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockImplementation(function (this: HTMLElement) {
      return {
        bottom: this.classList.contains('menu') ? bottom : 0,
        top: 0,
        left: 0,
        right: 0,
        width: 0,
        height: 0,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect;
    });
}

async function setup(viewport: FakeVisualViewport | null, menuBottom: number) {
  originalViewport = Object.getOwnPropertyDescriptor(window, 'visualViewport');
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
  stubMenuBottom(menuBottom);
  await TestBed.configureTestingModule({ imports: [HostWithMenu] }).compileComponents();
  const fixture = TestBed.createComponent(HostWithMenu);
  fixture.detectChanges();
  return fixture.nativeElement.querySelector('.menu') as HTMLElement;
}

afterEach(() => {
  rectSpy.mockRestore();
  if (originalViewport) Object.defineProperty(window, 'visualViewport', originalViewport);
  else delete (window as { visualViewport?: unknown }).visualViewport;
});

describe('MenuViewport (issue #149)', () => {
  it('flips .is-up when the menu would cross the visual viewport bottom', async () => {
    const menu = await setup(new FakeVisualViewport(600), 700);
    expect(menu.classList.contains('is-up')).toBe(true);
  });

  it('keeps the menu below its trigger while it fits', async () => {
    const menu = await setup(new FakeVisualViewport(600), 500);
    expect(menu.classList.contains('is-up')).toBe(false);
  });

  it('measures against the panned visual band, not the layout viewport', async () => {
    // iOS pans the visual viewport down (offsetTop): the visible band is
    // 372..600, so a menu ending at 500 still fits below its trigger.
    const menu = await setup(new FakeVisualViewport(228, 372), 500);
    expect(menu.classList.contains('is-up')).toBe(false);
  });

  it('falls back to innerHeight without a visualViewport', async () => {
    const menu = await setup(null, window.innerHeight + 50);
    expect(menu.classList.contains('is-up')).toBe(true);
  });
});
