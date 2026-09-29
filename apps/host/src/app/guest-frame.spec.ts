import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import type { HostAdapter } from '@klartext/bus-contract/conformance';
import { HOST_BUS_ADAPTER_FACTORY } from './bus/host-bus.adapter';
import { GuestFrame } from './guest-frame';
import { HOST_CONFIG } from './host-config';
import { OpenDocument } from './open-document';

class FakeOpenDocument {
  readonly docId = signal<string | null>('doc-1');
  readonly folderId = signal<string | null>(null);
  open = vi.fn();
  openFolder = vi.fn();
  close = vi.fn();
}

const fakeAdapter: HostAdapter = {
  openSession: vi.fn(),
  requestExtraction: vi.fn(),
  cancelJobs: vi.fn(),
  dispose: vi.fn(),
};

async function setup() {
  const openDocument = new FakeOpenDocument();
  await TestBed.configureTestingModule({
    imports: [GuestFrame],
    providers: [
      { provide: OpenDocument, useValue: openDocument },
      {
        provide: HOST_CONFIG,
        useValue: { guestOrigin: 'http://localhost:5055', useEmulators: true },
      },
      { provide: HOST_BUS_ADAPTER_FACTORY, useValue: vi.fn(() => fakeAdapter) },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(GuestFrame);
  fixture.detectChanges();
  for (let i = 0; i < 20; i++) await Promise.resolve();
  fixture.detectChanges();
  return { fixture, openDocument, el: fixture.nativeElement as HTMLElement };
}

function host(el: HTMLElement): HTMLElement {
  return el.querySelector<HTMLElement>('.guest-frame-host')!;
}

function handle(el: HTMLElement): HTMLButtonElement {
  return el.querySelector<HTMLButtonElement>('.sheet-handle')!;
}

function detent(el: HTMLElement): string | null {
  return host(el).getAttribute('data-sheet');
}

function tap(fixture: { detectChanges(): void }, el: HTMLElement): void {
  handle(el).click();
  fixture.detectChanges();
}

/** jsdom has no PointerEvent — a MouseEvent carries clientY and the handlers
 *  only read pointer-agnostic fields. An explicit timeStamp fakes velocity. */
function pointer(el: HTMLElement, type: string, clientY: number, timeStamp?: number): void {
  const event = new MouseEvent(type, { clientY, bubbles: true });
  if (timeStamp !== undefined) {
    Object.defineProperty(event, 'timeStamp', { value: timeStamp });
  }
  handle(el).dispatchEvent(event);
}

describe('GuestFrame mobile sheet detents (issue #50)', () => {
  it('rests at peek when a Document opens — strip plus a minimal header over the PDF', async () => {
    const { el } = await setup();
    expect(detent(el)).toBe('peek');

    const button = handle(el);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.getAttribute('aria-label')).toContain('Expand');
    // The grab bar is the drag affordance (issue #62) — no directional glyph.
    expect(button.querySelector('.handle-pill')).not.toBeNull();
    expect(button.querySelector('svg')).toBeNull();

    // The minimal header is chrome above the iframe, keeping the Extraction
    // discoverable while the sheet only covers a sliver of the reader.
    const head = el.querySelector<HTMLElement>('.sheet-head')!;
    expect(head.textContent).toContain('Insights');
    const frame = el.querySelector<HTMLIFrameElement>('iframe.guest-frame')!;
    expect(
      head.compareDocumentPosition(frame) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('the handle cycles peek → half → full → peek', async () => {
    const { fixture, el } = await setup();
    expect(detent(el)).toBe('peek');

    tap(fixture, el);
    expect(detent(el)).toBe('half');
    tap(fixture, el);
    expect(detent(el)).toBe('full');
    tap(fixture, el);
    expect(detent(el)).toBe('peek');
  });

  it("the handle's label reads where a tap moves the sheet", async () => {
    const { fixture, el } = await setup();
    const button = handle(el);

    // peek: collapsed to a11y; a tap expands.
    expect(button.getAttribute('aria-expanded')).toBe('false');

    tap(fixture, el);
    // half: the sheet is expanded; next stop is full.
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(button.getAttribute('aria-label')).toContain('full');

    tap(fixture, el);
    // full: the only way left is down, back to peek.
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(button.getAttribute('aria-label')).toContain('Collapse');
  });

  it('opening another Document rests the sheet back at peek', async () => {
    const { fixture, el, openDocument } = await setup();
    tap(fixture, el);
    tap(fixture, el);
    expect(detent(el)).toBe('full');

    openDocument.docId.set('doc-2');
    fixture.detectChanges();
    expect(detent(el)).toBe('peek');
  });

  it('a drag tracks the finger, then snaps to the nearest detent on release', async () => {
    const { fixture, el } = await setup();
    const vh = window.innerHeight;
    const sheet = host(el);

    // Press near the sheet's top edge, drag until the sheet stands half open.
    // Explicit timeStamps keep the flick velocity under threshold.
    pointer(el, 'pointerdown', vh - 76, 0);
    pointer(el, 'pointermove', vh * 0.5, 1000);
    expect(sheet.classList.contains('is-dragging')).toBe(true);
    expect(sheet.style.height).toBe(`${vh * 0.5}px`);

    pointer(el, 'pointerup', vh * 0.5, 1050);
    expect(detent(el)).toBe('half');
    expect(sheet.style.height).toBe('');
    expect(sheet.classList.contains('is-dragging')).toBe(false);

    // The click the release still fires must not cycle on top of the snap.
    handle(el).click();
    fixture.detectChanges();
    expect(detent(el)).toBe('half');
  });

  it('release snaps to the nearest detent — a short pull returns to peek', async () => {
    const { el } = await setup();
    const vh = window.innerHeight;

    // jsdom: peek resolves to its 76px fallback, so the peek/half midpoint
    // sits at (76 + vh/2) / 2 ≈ 230 — a 200px sheet lands below it.
    pointer(el, 'pointerdown', vh - 76, 0);
    pointer(el, 'pointermove', vh - 200, 1000);
    pointer(el, 'pointerup', vh - 200, 1050);
    expect(detent(el)).toBe('peek');
  });

  it('a fast flick moves one detent in the flick direction', async () => {
    const { el } = await setup();
    const vh = window.innerHeight;

    // Released at ~140px — nearest detent is peek — but the upward flick
    // overrides position and takes the sheet to half.
    pointer(el, 'pointerdown', vh - 76, 0);
    pointer(el, 'pointermove', vh - 120, 10);
    pointer(el, 'pointerup', vh - 140, 20);
    expect(detent(el)).toBe('half');
  });

  it('a wobble under the drag threshold still taps through', async () => {
    const { fixture, el } = await setup();
    const vh = window.innerHeight;

    pointer(el, 'pointerdown', vh - 76, 0);
    pointer(el, 'pointermove', vh - 73, 100);
    pointer(el, 'pointerup', vh - 73, 150);
    tap(fixture, el);
    expect(detent(el)).toBe('half');
  });

  it('the handle is a strip in the sheet chrome ahead of the iframe, not overlaid', async () => {
    const { el } = await setup();
    const button = handle(el);
    const frame = el.querySelector<HTMLIFrameElement>('iframe.guest-frame')!;
    // Siblings in flow — the handle is its own row, so it cannot cover Guest content.
    expect(button.parentElement).toBe(frame.parentElement);
    expect(
      button.compareDocumentPosition(frame) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
