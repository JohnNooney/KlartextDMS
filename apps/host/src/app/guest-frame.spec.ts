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

function handle(el: HTMLElement): HTMLButtonElement {
  return el.querySelector<HTMLButtonElement>('.sheet-handle')!;
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

describe('GuestFrame mobile sheet handle (issue #49)', () => {
  it('collapsed: the chevron points up — the direction a tap moves the sheet', async () => {
    const { el } = await setup();
    const button = handle(el);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.getAttribute('aria-label')).toContain('Expand');
    expect(chevronDirection(button.querySelector('path')!.getAttribute('d')!)).toBe('up');
  });

  it('a tap expands the sheet and the chevron flips to down', async () => {
    const { fixture, el } = await setup();
    handle(el).click();
    fixture.detectChanges();

    const button = handle(el);
    expect(el.querySelector('.guest-frame-host')!.classList.contains('is-full')).toBe(true);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(button.getAttribute('aria-label')).toContain('Collapse');
    expect(chevronDirection(button.querySelector('path')!.getAttribute('d')!)).toBe('down');
  });

  it('a second tap collapses back to the half sheet', async () => {
    const { fixture, el } = await setup();
    handle(el).click();
    fixture.detectChanges();
    handle(el).click();
    fixture.detectChanges();

    expect(el.querySelector('.guest-frame-host')!.classList.contains('is-full')).toBe(false);
    expect(handle(el).getAttribute('aria-expanded')).toBe('false');
  });

  it('the handle is a strip in the sheet chrome ahead of the iframe, not overlaid', async () => {
    const { el } = await setup();
    const button = handle(el);
    const frame = el.querySelector<HTMLIFrameElement>('iframe.guest-frame')!;
    // Siblings in flow — the handle is its own row, so it cannot cover Guest content.
    expect(button.parentElement).toBe(frame.parentElement);
    expect(button.compareDocumentPosition(frame) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
