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

/** Index of the lit dot in the handle's detent indicator. */
function activeDot(el: HTMLElement): number {
  return [...el.querySelectorAll('.sheet-dots > span')].findIndex((d) =>
    d.classList.contains('is-active'),
  );
}

/** Reads the chevron path as three absolute points; the apex sits above or below the baseline. */
function chevronDirection(path: string): 'up' | 'down' {
  const [, y1, , dy1, , dy2] = path.match(/-?\d+(?:\.\d+)?/g)!.map(Number) as [
    number, number, number, number, number, number,
  ];
  const apexY = y1 + dy1;
  const farEndY = y1 + dy1 + dy2;
  return apexY < y1 && apexY < farEndY ? 'up' : 'down';
}

function chevron(el: HTMLElement): 'up' | 'down' {
  return chevronDirection(handle(el).querySelector('path')!.getAttribute('d')!);
}

function tap(fixture: { detectChanges(): void }, el: HTMLElement): void {
  handle(el).click();
  fixture.detectChanges();
}

describe('GuestFrame mobile sheet detents (issue #50)', () => {
  it('rests at peek when a Document opens — strip plus a minimal header over the PDF', async () => {
    const { el } = await setup();
    expect(detent(el)).toBe('peek');

    const button = handle(el);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.getAttribute('aria-label')).toContain('Expand');
    expect(chevron(el)).toBe('up');

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

  it('the affordance reads the current detent and the direction a tap moves', async () => {
    const { fixture, el } = await setup();
    const button = handle(el);

    // peek: one more tap goes up; first dot lit; collapsed to a11y.
    expect(activeDot(el)).toBe(0);
    expect(chevron(el)).toBe('up');
    expect(button.getAttribute('aria-expanded')).toBe('false');

    tap(fixture, el);
    // half: still up (next is full); second dot lit; the sheet is expanded.
    expect(activeDot(el)).toBe(1);
    expect(chevron(el)).toBe('up');
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(button.getAttribute('aria-label')).toContain('full');

    tap(fixture, el);
    // full: the only way left is down, back to peek.
    expect(activeDot(el)).toBe(2);
    expect(chevron(el)).toBe('down');
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
