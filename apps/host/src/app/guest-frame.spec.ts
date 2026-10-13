import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostAdapter } from '@klartext/bus-contract/conformance';
import { HOST_BUS_ADAPTER_FACTORY } from './bus/host-bus.adapter';
import { GuestFrame } from './guest-frame';
import { HOST_CONFIG } from './host-config';
import { OpenDocument } from './open-document';
import { PageFocus } from './page-focus';
import { SheetExpand } from './sheet-expand';

class FakeOpenDocument {
  readonly docId = signal<string | null>('doc-1');
  readonly folderId = signal<string | null>(null);
  readonly insightsLaneHidden = signal(false);
  open = vi.fn();
  openFolder = vi.fn();
  close = vi.fn();
  toggleInsightsLane = vi.fn();
}

const fakeAdapter: HostAdapter = {
  openSession: vi.fn(),
  requestExtraction: vi.fn(),
  cancelJobs: vi.fn(),
  setPresentation: vi.fn(),
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
  it('rests at peek when a Document opens — handle plus the Guest jump bar over the PDF', async () => {
    const { el } = await setup();
    expect(detent(el)).toBe('peek');

    const button = handle(el);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.getAttribute('aria-label')).toContain('Expand');
    // The grab bar is the drag affordance (issue #62) — no directional glyph.
    expect(button.querySelector('.handle-pill')).not.toBeNull();
    expect(button.querySelector('svg')).toBeNull();

    // Issue #79: the "Insights" header is gone — at peek the iframe's top
    // sliver shows the Guest's own jump bar, tappable through the frame.
    expect(el.querySelector('.sheet-head')).toBeNull();
    const frame = el.querySelector<HTMLIFrameElement>('iframe.guest-frame')!;
    expect(
      button.compareDocumentPosition(frame) & Node.DOCUMENT_POSITION_FOLLOWING,
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
    pointer(el, 'pointerdown', vh - 88, 0);
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

    // jsdom: peek resolves to its 88px fallback, so the peek/half midpoint
    // sits at (88 + vh/2) / 2 ≈ 236 — a 200px sheet lands below it.
    pointer(el, 'pointerdown', vh - 88, 0);
    pointer(el, 'pointermove', vh - 200, 1000);
    pointer(el, 'pointerup', vh - 200, 1050);
    expect(detent(el)).toBe('peek');
  });

  it('a fast flick moves one detent in the flick direction', async () => {
    const { el } = await setup();
    const vh = window.innerHeight;

    // Released at ~140px — nearest detent is peek — but the upward flick
    // overrides position and takes the sheet to half.
    pointer(el, 'pointerdown', vh - 88, 0);
    pointer(el, 'pointermove', vh - 120, 10);
    pointer(el, 'pointerup', vh - 140, 20);
    expect(detent(el)).toBe('half');
  });

  it('a wobble under the drag threshold still taps through', async () => {
    const { fixture, el } = await setup();
    const vh = window.innerHeight;

    pointer(el, 'pointerdown', vh - 88, 0);
    pointer(el, 'pointermove', vh - 85, 100);
    pointer(el, 'pointerup', vh - 85, 150);
    tap(fixture, el);
    expect(detent(el)).toBe('half');
  });

  it('a hidden lane hides the frame but keeps it mounted — jobs run on (#76)', async () => {
    const { fixture, el, openDocument } = await setup();
    expect(host(el).classList.contains('lane-hidden')).toBe(false);

    openDocument.insightsLaneHidden.set(true);
    fixture.detectChanges();

    // Hidden like "no Document open" — but by class, not `hidden`, so the
    // mobile sheet's detents aren't stranded by a desktop hide.
    const sheet = host(el);
    expect(sheet.classList.contains('lane-hidden')).toBe(true);
    expect(sheet.hasAttribute('hidden')).toBe(false);
    expect(el.querySelector('iframe.guest-frame')).toBeTruthy();
  });

  // Issue #78: a landed show-page request rests the sheet at half — the
  // jumped-to page shows above it while the takeaways stay in reach; a
  // request that never lands leaves it alone.
  it('a landed page request rests the sheet at half', async () => {
    const { fixture, el } = await setup();
    tap(fixture, el);
    tap(fixture, el);
    expect(detent(el)).toBe('full');

    const focus = TestBed.inject(PageFocus);
    focus.registerNavigator({ pageCount: () => 4, showPage: vi.fn() });
    focus.show({ page: 3 });
    fixture.detectChanges();
    expect(detent(el)).toBe('half');

    // From peek too — the same request lifts it to half.
    tap(fixture, el);
    tap(fixture, el);
    expect(detent(el)).toBe('peek');
    focus.show({ page: 2 });
    fixture.detectChanges();
    expect(detent(el)).toBe('half');
  });

  it('an out-of-range page request leaves the sheet alone', async () => {
    const { fixture, el } = await setup();
    tap(fixture, el);
    tap(fixture, el);
    expect(detent(el)).toBe('full');

    const focus = TestBed.inject(PageFocus);
    focus.registerNavigator({ pageCount: () => 4, showPage: vi.fn() });
    focus.show({ page: 99 });
    fixture.detectChanges();

    expect(detent(el)).toBe('full');
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

// Issue #77: the frame reports its lane/sheet presentation over the Bus —
// on mount (buffered until GUEST_READY by the adapter) and on every
// crossing of the same 768px mobile breakpoint the frame's CSS uses.
describe('GuestFrame panel presentation (issue #77)', () => {
  // jsdom has no matchMedia — a stubbed MediaQueryList drives the tests.
  let fakeMedia: { matches: boolean; addEventListener: ReturnType<typeof vi.fn>; removeEventListener: ReturnType<typeof vi.fn> };
  let crossing: (() => void) | null;

  beforeEach(() => {
    crossing = null;
    fakeMedia = {
      matches: false,
      addEventListener: vi.fn((_type: string, listener: () => void) => {
        crossing = listener;
      }),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal('matchMedia', vi.fn(() => fakeMedia));
    vi.mocked(fakeAdapter.setPresentation).mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports the lane mode on mount at desktop widths', async () => {
    await setup();
    expect(window.matchMedia).toHaveBeenCalledWith('(max-width: 768px)');
    expect(fakeAdapter.setPresentation).toHaveBeenCalledWith('lane');
  });

  it('reports the sheet mode on mount under the mobile breakpoint', async () => {
    fakeMedia.matches = true;
    await setup();
    expect(fakeAdapter.setPresentation).toHaveBeenCalledWith('sheet');
  });

  it('reports each breakpoint crossing', async () => {
    await setup();
    expect(fakeAdapter.setPresentation).toHaveBeenCalledTimes(1);

    fakeMedia.matches = true;
    crossing!();
    expect(fakeAdapter.setPresentation).toHaveBeenLastCalledWith('sheet');

    fakeMedia.matches = false;
    crossing!();
    expect(fakeAdapter.setPresentation).toHaveBeenLastCalledWith('lane');
  });

  it('stops listening on destroy', async () => {
    const { fixture } = await setup();
    fixture.destroy();
    expect(fakeMedia.removeEventListener).toHaveBeenCalledWith('change', crossing);
  });
});

// Issue #79: the Guest can't raise its own sheet — a jump-bar tap sends
// GUEST_EXPAND_PANEL, which lands as a SheetExpand request through the Bus
// outcome chain. A peeking sheet lifts to half; every other detent, and
// the desktop lane, ignore it.
describe('GuestFrame expand-panel requests (issue #79)', () => {
  let fakeMedia: { matches: boolean; addEventListener: ReturnType<typeof vi.fn>; removeEventListener: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    fakeMedia = {
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal('matchMedia', vi.fn(() => fakeMedia));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('raises a peeking sheet to half', async () => {
    const { fixture, el } = await setup();
    expect(detent(el)).toBe('peek');

    TestBed.inject(SheetExpand).request();
    fixture.detectChanges();

    expect(detent(el)).toBe('half');
  });

  it('leaves the half and full detents alone', async () => {
    const { fixture, el } = await setup();
    const expand = TestBed.inject(SheetExpand);

    tap(fixture, el);
    expand.request();
    fixture.detectChanges();
    expect(detent(el)).toBe('half');

    tap(fixture, el);
    expand.request();
    fixture.detectChanges();
    expect(detent(el)).toBe('full');
  });

  it('collapsing back to peek after a request does not re-raise the sheet', async () => {
    const { fixture, el } = await setup();
    const expand = TestBed.inject(SheetExpand);
    expand.request();
    fixture.detectChanges();
    expect(detent(el)).toBe('half');

    // The user drags the sheet back to peek — the earlier request is spent;
    // it must not fire again.
    tap(fixture, el); // half → full
    tap(fixture, el); // full → peek
    expect(detent(el)).toBe('peek');
  });

  it('is ignored on desktop — there is no sheet in the lane presentation', async () => {
    fakeMedia.matches = false;
    const { fixture, el } = await setup();

    TestBed.inject(SheetExpand).request();
    fixture.detectChanges();

    expect(detent(el)).toBe('peek');
  });
});
