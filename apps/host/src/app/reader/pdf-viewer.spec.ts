import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import type { DocumentRecord } from '../data/document';
import { DOCUMENT_REPOSITORY } from '../data/providers';
import {
  LARGE_DOCUMENT_BYTES,
  LARGE_DOCUMENT_PAGES,
  PDF_ENGINE,
  type PdfDocumentRef,
  type PdfEngine,
  type PdfPageRef,
} from './pdf-engine';
import { PdfViewer } from './pdf-viewer';

function record(overrides: Partial<DocumentRecord> = {}): DocumentRecord {
  return {
    id: 'doc-1',
    ownerId: 'owner',
    title: 'Mietvertrag 2024',
    originalFilename: 'mietvertrag-2024.pdf',
    contentType: 'application/pdf',
    sizeBytes: 1024,
    storagePath: 'users/owner/documents/doc-1.pdf',
    status: 'ready',
    folderId: null,
    createdAt: { seconds: 1, nanoseconds: 0 },
    updatedAt: { seconds: 1, nanoseconds: 0 },
    ...overrides,
  };
}

class FakePdfPage implements PdfPageRef {
  readonly renders: number[] = [];
  readonly width = 600;
  readonly height = 800;

  async render(_canvas: HTMLCanvasElement, cssScale: number): Promise<void> {
    this.renders.push(cssScale);
  }
}

class FakePdfDoc implements PdfDocumentRef {
  readonly pages = new Map<number, FakePdfPage>();
  destroyed = false;

  constructor(public readonly numPages: number) {}

  async page(n: number): Promise<PdfPageRef> {
    let page = this.pages.get(n);
    if (!page) this.pages.set(n, (page = new FakePdfPage()));
    return page;
  }

  destroy(): void {
    this.destroyed = true;
  }
}

/** The `?sim=` equivalent (issue #29): ok / corrupt / large. */
class FakeEngine implements PdfEngine {
  calls = 0;
  doc = new FakePdfDoc(3);
  corrupt = false;

  load(source: {
    data: ArrayBuffer;
    onProgress?: (progress: { loaded: number; total?: number }) => void;
  }): Promise<PdfDocumentRef> {
    this.calls++;
    source.onProgress?.({ loaded: 2, total: 4 });
    if (this.corrupt) return Promise.reject(new Error('bad pdf'));
    return Promise.resolve(this.doc);
  }
}

const fakeRepository = {
  getBytes: vi.fn(async () => new Uint8Array(8).buffer),
};

async function setup(opts: { numPages?: number; sizeBytes?: number } = {}) {
  const engine = new FakeEngine();
  engine.doc = new FakePdfDoc(opts.numPages ?? 3);
  Object.assign(URL, {
    createObjectURL: vi.fn(() => 'blob:fake-url'),
    revokeObjectURL: vi.fn(),
  });
  fakeRepository.getBytes.mockClear();
  await TestBed.configureTestingModule({
    imports: [PdfViewer],
    providers: [
      { provide: PDF_ENGINE, useValue: engine },
      { provide: DOCUMENT_REPOSITORY, useValue: fakeRepository },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(PdfViewer);
  fixture.componentRef.setInput('doc', record({ sizeBytes: opts.sizeBytes ?? 1024 }));
  fixture.detectChanges();
  return { fixture, engine, el: fixture.nativeElement as HTMLElement };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

async function settle(fixture: ComponentFixture<PdfViewer>): Promise<void> {
  await flush();
  fixture.detectChanges();
}

function chromeButton(el: HTMLElement, label: string): HTMLButtonElement {
  return el.querySelector<HTMLButtonElement>(`.pdf-chrome button[aria-label="${label}"]`)!;
}

describe('PdfViewer (issue #29)', () => {
  it('shows a skeleton and parse progress while loading', async () => {
    const { fixture, el } = await setup();
    // Before the async load settles the stage shows the skeleton + progress.
    expect(el.querySelector('.pdf-skeleton')).toBeTruthy();
    fixture.detectChanges();
    expect(el.textContent).toContain('Loading 50%');
  });

  it('renders page 1 of N once loaded: canvas + indicator + a11y labels', async () => {
    const { fixture, el } = await setup({ numPages: 3 });
    await settle(fixture);

    const canvas = el.querySelector('canvas');
    expect(canvas).toBeTruthy();
    expect(canvas!.getAttribute('role')).toBe('img');
    expect(canvas!.getAttribute('aria-label')).toBe('Page 1 of 3');
    expect(el.querySelector('.pdf-pageno')?.textContent).toContain('1 / 3');
    expect(el.querySelector('.pdf-pageno')?.getAttribute('aria-live')).toBe('polite');
    expect(el.querySelector('.pdf-skeleton')).toBeNull();
  });

  it('pages with the chevrons and disables them at the bounds', async () => {
    const { fixture, el } = await setup({ numPages: 3 });
    await settle(fixture);

    const prev = chromeButton(el, 'Previous page');
    const next = chromeButton(el, 'Next page');
    expect(prev.disabled).toBe(true);
    expect(next.disabled).toBe(false);

    next.click();
    await settle(fixture);
    expect(el.querySelector('canvas')!.getAttribute('aria-label')).toBe('Page 2 of 3');
    expect(el.querySelector('.pdf-pageno')?.textContent).toContain('2 / 3');
    expect(prev.disabled).toBe(false);

    next.click();
    await settle(fixture);
    expect(el.querySelector('canvas')!.getAttribute('aria-label')).toBe('Page 3 of 3');
    expect(next.disabled).toBe(true);

    prev.click();
    await settle(fixture);
    expect(el.querySelector('canvas')!.getAttribute('aria-label')).toBe('Page 2 of 3');
  });

  it('zooms in and out, re-rendering the page at a new scale', async () => {
    const { fixture, engine, el } = await setup();
    await settle(fixture);
    const page = engine.doc.pages.get(1)!;
    const base = page.renders.at(-1)!;

    chromeButton(el, 'Zoom in').click();
    await settle(fixture);
    expect(page.renders.at(-1)!).toBeGreaterThan(base);

    chromeButton(el, 'Zoom out').click();
    await settle(fixture);
    expect(page.renders.at(-1)!).toBeLessThan(page.renders.at(-2)!);
  });

  it('a corrupt PDF shows the error card with Try again and Open in browser', async () => {
    const { fixture, engine, el } = await setup();
    engine.corrupt = true;
    fixture.componentRef.setInput('doc', record({ id: 'doc-bad' }));
    fixture.detectChanges();
    await settle(fixture);

    const card = el.querySelector('.pdf-error');
    expect(card?.textContent).toContain('Couldn’t open this PDF');
    const browser = card?.querySelector<HTMLAnchorElement>('a.btn-secondary');
    expect(browser?.href).toBe('blob:fake-url');
    expect(browser?.target).toBe('_blank');

    engine.corrupt = false;
    (card!.querySelector<HTMLButtonElement>('.btn-primary'))!.click();
    await settle(fixture);
    // Initial load + corrupt reload + Try again.
    expect(engine.calls).toBe(3);
    expect(el.querySelector('canvas')).toBeTruthy();
  });

  it('flags large Documents as potentially slow without blocking them', async () => {
    const { fixture, el } = await setup({ sizeBytes: LARGE_DOCUMENT_BYTES + 1 });
    fixture.detectChanges();
    expect(el.textContent).toContain('may be slow to render');
    await settle(fixture);
    expect(el.querySelector('canvas')).toBeTruthy();
  });

  it('flags many-page Documents as potentially slow once parsed', async () => {
    const { fixture, el } = await setup({ numPages: LARGE_DOCUMENT_PAGES + 1 });
    fixture.detectChanges();
    expect(el.textContent).not.toContain('may be slow to render');
    await settle(fixture);
    expect(el.textContent).toContain('may be slow to render');
  });

  it('goToPage jumps to a page (the GUEST_SHOW_PAGE seam)', async () => {
    const { fixture, engine, el } = await setup({ numPages: 5 });
    await settle(fixture);

    fixture.componentInstance.goToPage(4);
    await settle(fixture);

    expect(fixture.componentInstance.page()).toBe(4);
    expect(el.querySelector('canvas')!.getAttribute('aria-label')).toBe('Page 4 of 5');
    expect(engine.doc.pages.get(4)!.renders.length).toBeGreaterThan(0);
  });

  it('goToPage clamps out-of-range pages', async () => {
    const { fixture } = await setup({ numPages: 3 });
    await settle(fixture);

    fixture.componentInstance.goToPage(99);
    await settle(fixture);
    expect(fixture.componentInstance.page()).toBe(3);

    fixture.componentInstance.goToPage(0);
    await settle(fixture);
    expect(fixture.componentInstance.page()).toBe(1);
  });

  it('exposes an Open in browser link backed by the Document bytes', async () => {
    const { fixture, el } = await setup();
    await settle(fixture);
    const link = el.querySelector<HTMLAnchorElement>('.pdf-chrome a[aria-label="Open in browser"]');
    expect(link).toBeTruthy();
    expect(link!.href).toBe('blob:fake-url');
    expect(fakeRepository.getBytes).toHaveBeenCalledWith('doc-1');
  });

  it('re-loads when the open Document changes', async () => {
    const { fixture, engine } = await setup();
    await settle(fixture);
    fixture.componentRef.setInput('doc', record({ id: 'doc-2', title: 'Second' }));
    fixture.detectChanges();
    await settle(fixture);
    expect(engine.calls).toBe(2);
    expect(fakeRepository.getBytes).toHaveBeenCalledWith('doc-2');
  });
});
