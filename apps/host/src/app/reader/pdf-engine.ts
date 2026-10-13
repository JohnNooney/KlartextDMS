/**
 * The PDF rendering seam (issue #29): the viewer talks to `PDF_ENGINE`, never
 * to pdf.js directly. Tests substitute fakes at this token — the unit-level
 * equivalent of the prototype's `?sim=slow|large|corrupt` switches — so
 * paging, zoom, loading, failure, and size states run without a real PDF.
 */
import { InjectionToken } from '@angular/core';

/** Progress reported by `PdfEngine.load` (`total` may be unknown early). */
export interface PdfLoadProgress {
  loaded: number;
  total?: number;
}

/** One page of a loaded Document, renderable onto a canvas. */
export interface PdfPageRef {
  /** Intrinsic size at scale 1 — the viewer's fit-to-width basis. */
  readonly width: number;
  readonly height: number;
  /** Paints the page at `cssScale × devicePixelRatio`, sizing the canvas. */
  render(canvas: HTMLCanvasElement, cssScale: number): Promise<void>;
  /**
   * Pours the page's pdf.js text layer into `container` at `cssScale`
   * (issue #80) — the invisible, item-aligned overlay the quote matcher
   * searches and the highlight wraps.
   */
  renderTextLayer(container: HTMLElement, cssScale: number): Promise<PdfTextLayerRef>;
}

/** A rendered text layer (issue #80): item-aligned strings and spans. */
export interface PdfTextLayerRef {
  /** The per-item strings the quote matcher searches (`textContentItemsStr`). */
  readonly itemsStr: readonly string[];
  /** The per-item spans the highlight wraps (`textDivs`). */
  readonly divs: readonly HTMLElement[];
  /** Re-fits the layer after a zoom re-render — same page, new cssScale. */
  update(cssScale: number): void;
}

/** A loaded PDF: fixed page count, per-page handles, and teardown. */
export interface PdfDocumentRef {
  readonly numPages: number;
  page(n: number): Promise<PdfPageRef>;
  destroy(): void;
}

export interface PdfEngine {
  load(source: {
    data: ArrayBuffer;
    onProgress?: (progress: PdfLoadProgress) => void;
  }): Promise<PdfDocumentRef>;
}

export const PDF_ENGINE = new InjectionToken<PdfEngine>('PDF_ENGINE');

/** View-time warning thresholds (issue #17): informational, not a block. */
export const LARGE_DOCUMENT_BYTES = 5 * 1024 * 1024;
export const LARGE_DOCUMENT_PAGES = 50;
