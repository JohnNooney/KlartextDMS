import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { DialogViewport } from './dialog-viewport';

@Component({ template: '<div class="dialog"></div>', imports: [DialogViewport] })
class HostWithDialog {}

class FakeVisualViewport extends EventTarget {
  constructor(
    public height: number,
    public offsetTop = 0,
  ) {
    super();
  }
}

let original: PropertyDescriptor | undefined;

async function setup(viewport: FakeVisualViewport | null) {
  original = Object.getOwnPropertyDescriptor(window, 'visualViewport');
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
  await TestBed.configureTestingModule({ imports: [HostWithDialog] }).compileComponents();
  const fixture = TestBed.createComponent(HostWithDialog);
  fixture.detectChanges();
  return fixture.nativeElement.querySelector('.dialog') as HTMLElement;
}

afterEach(() => {
  if (original) Object.defineProperty(window, 'visualViewport', original);
  else delete (window as { visualViewport?: unknown }).visualViewport;
});

describe('DialogViewport (issue #64)', () => {
  it('centres the .dialog in the visual viewport and caps its height', async () => {
    const dialog = await setup(new FakeVisualViewport(800));
    expect(dialog.style.top).toBe('400px');
    expect(dialog.style.maxHeight).toBe('752px');
  });

  it('follows the visual viewport as the on-screen keyboard shrinks it', async () => {
    const viewport = new FakeVisualViewport(800);
    const dialog = await setup(viewport);

    // Keyboard opens: the visible band shrinks and may pan (offsetTop).
    viewport.height = 360;
    viewport.offsetTop = 12;
    viewport.dispatchEvent(new Event('resize'));
    expect(dialog.style.top).toBe('192px');
    expect(dialog.style.maxHeight).toBe('312px');

    // Safari pans the visual viewport to reveal the focused field.
    viewport.offsetTop = 40;
    viewport.dispatchEvent(new Event('scroll'));
    expect(dialog.style.top).toBe('220px');
  });

  it('leaves the stylesheet placement alone without a visualViewport', async () => {
    const dialog = await setup(null);
    expect(dialog.style.top).toBe('');
    expect(dialog.style.maxHeight).toBe('');
  });
});
