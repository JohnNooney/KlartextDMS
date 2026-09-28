import {
  Component,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import type { DocumentRecord } from '../data/document';
import { DOCUMENT_REPOSITORY } from '../data/providers';
import {
  LARGE_DOCUMENT_BYTES,
  LARGE_DOCUMENT_PAGES,
  PDF_ENGINE,
  type PdfDocumentRef,
} from './pdf-engine';

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2.5;
const ZOOM_STEP = 0.2;
/** pdf.js fit-to-width cap, per the prototype's paged viewer (issue #17). */
const MAX_FIT = 1.4;
const STAGE_PADDING = 48;

/**
 * The Host's paged PDF viewer (issues #17, #29; prototype variant B): one page
 * at a time — prev/next chevrons, an `n / N` live indicator, zoom −/+, and an
 * "Open in browser" escape. Page awareness lives here: `page` + `goToPage(n)`
 * are the seam the v2 `GUEST_SHOW_PAGE` message (#19) will call into.
 * States: skeleton + progress % while bytes/parse run, an error card on
 * failure, and a non-blocking "large document" note past the size thresholds.
 */
@Component({
  selector: 'app-pdf-viewer',
  templateUrl: './pdf-viewer.html',
  styleUrl: './pdf-viewer.scss',
})
export class PdfViewer {
  readonly doc = input.required<DocumentRecord>();

  /** Current 1-based page — read by the Session layer for page awareness. */
  readonly page = signal(1);

  protected readonly numPages = signal(0);
  protected readonly state = signal<'loading' | 'ready' | 'error'>('loading');
  /** Parse progress in percent, `null` while the total is unknown. */
  protected readonly progress = signal<number | null>(null);
  protected readonly zoom = signal(1);
  protected readonly large = signal(false);
  /** Blob URL for "Open in browser" — minted once the bytes land. */
  protected readonly browserUrl = signal<string | null>(null);

  protected readonly minZoom = MIN_ZOOM;
  protected readonly maxZoom = MAX_ZOOM;
  /** Skeleton line count, per the prototype's loading page. */
  protected readonly skeletonLines = Array.from({ length: 14 });

  private readonly engine = inject(PDF_ENGINE);
  private readonly repository = inject(DOCUMENT_REPOSITORY);
  private readonly stage = viewChild<ElementRef<HTMLElement>>('stage');
  private readonly canvas = viewChild<ElementRef<HTMLCanvasElement>>('canvas');

  private pdf: PdfDocumentRef | null = null;
  /** Guards async renders against Document switches mid-flight. */
  private generation = 0;
  /**
   * Render serialization: pdf.js throws when two `render()` calls touch one
   * canvas, so callers enqueue and the drain renders the latest request only
   * (rapid chevron/zoom clicks coalesce instead of racing).
   */
  private renderQueued: number | null = null;
  private renderActive = false;
  /** The page the queue is aiming at — stepping continues from here. */
  private target = 1;

  constructor() {
    // The Document drives the load pipeline; `untracked` keeps the load's own
    // signal writes (progress, page, url) from re-firing the effect.
    effect(() => {
      const doc = this.doc();
      untracked(() => void this.load(doc));
    });
    inject(DestroyRef).onDestroy(() => {
      this.generation++;
      this.renderQueued = null;
      this.teardownDocument();
    });
  }

  /**
   * Jumps to a page — the Host-side `goToPage(n)` that `GUEST_SHOW_PAGE` (#19)
   * will drive. Clamps into range.
   */
  goToPage(n: number): void {
    const total = this.numPages();
    if (total === 0) return;
    this.requestRender(Math.min(Math.max(1, Math.round(n)), total));
  }

  protected prevPage(): void {
    this.requestRender(this.target - 1);
  }

  protected nextPage(): void {
    this.requestRender(this.target + 1);
  }

  protected zoomIn(): void {
    this.setZoom(this.zoom() + ZOOM_STEP);
  }

  protected zoomOut(): void {
    this.setZoom(this.zoom() - ZOOM_STEP);
  }

  /** The error card's Try again: re-runs the whole byte/parse pipeline. */
  protected retry(): void {
    void this.load(this.doc());
  }

  private setZoom(zoom: number): void {
    this.zoom.set(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom)));
    this.requestRender(this.target);
  }

  private async load(doc: DocumentRecord): Promise<void> {
    const generation = ++this.generation;
    this.teardownDocument();
    this.state.set('loading');
    this.progress.set(null);
    this.page.set(1);
    this.numPages.set(0);
    this.large.set(doc.sizeBytes > LARGE_DOCUMENT_BYTES);

    try {
      const bytes = await this.repository.getBytes(doc.id);
      if (generation !== this.generation) return;
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      if (generation !== this.generation) {
        URL.revokeObjectURL(url);
        return;
      }
      this.browserUrl.set(url);

      const pdf = await this.engine.load({
        data: bytes,
        onProgress: (p) =>
          this.progress.set(p.total ? Math.round((p.loaded / p.total) * 100) : null),
      });
      if (generation !== this.generation) {
        pdf.destroy();
        return;
      }
      this.pdf = pdf;
      this.numPages.set(pdf.numPages);
      if (pdf.numPages > LARGE_DOCUMENT_PAGES) this.large.set(true);
      this.state.set('ready');
      this.target = 1;
      this.requestRender(1);
    } catch {
      if (generation === this.generation) this.state.set('error');
    }
  }

  private requestRender(page: number): void {
    this.target = page;
    this.renderQueued = page;
    if (this.renderActive) return;
    this.renderActive = true;
    void this.drainRenders();
  }

  /** Drains the queue — only the latest request paints per engine call. */
  private async drainRenders(): Promise<void> {
    while (this.renderQueued !== null) {
      const page = this.renderQueued;
      this.renderQueued = null;
      await this.renderPage(page);
    }
    this.renderActive = false;
  }

  private async renderPage(n: number): Promise<void> {
    const pdf = this.pdf;
    const canvas = this.canvas()?.nativeElement;
    const stage = this.stage()?.nativeElement;
    if (!pdf || !canvas || !stage || n < 1 || n > pdf.numPages) return;
    const generation = this.generation;

    try {
      const pdfPage = await pdf.page(n);
      if (generation !== this.generation) return;
      const fit =
        stage.clientWidth > STAGE_PADDING ? (stage.clientWidth - STAGE_PADDING) / pdfPage.width : 1;
      const scale = Math.min(fit, MAX_FIT) * this.zoom();
      await pdfPage.render(canvas, scale);
      if (generation !== this.generation) return;
      // The indicator trails the paint so "Page n" always names the canvas.
      this.page.set(n);
    } catch {
      // A torn-down Document rejects in-flight engine calls; the next queued
      // render (or the error state) owns the canvas.
    }
  }

  private teardownDocument(): void {
    this.pdf?.destroy();
    this.pdf = null;
    const url = this.browserUrl();
    if (url) {
      URL.revokeObjectURL(url);
      this.browserUrl.set(null);
    }
  }
}
