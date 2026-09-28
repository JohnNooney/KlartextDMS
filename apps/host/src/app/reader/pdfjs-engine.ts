import { Injectable } from '@angular/core';
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import type { PdfDocumentRef, PdfEngine, PdfPageRef } from './pdf-engine';

/**
 * The pdf.js adapter behind `PDF_ENGINE` (issue #29). pdf.js is lazy-loaded —
 * a half-megabyte parser shouldn't cost the library its first paint; the
 * dynamic import also keeps the engine out of unit-test module graphs.
 * The worker ships as a static asset (angular.json copies
 * `pdf.worker.min.mjs` next to `assets/`).
 */
@Injectable()
export class PdfJsEngine implements PdfEngine {
  private pdfjs: Promise<typeof import('pdfjs-dist')> | null = null;

  private module(): Promise<typeof import('pdfjs-dist')> {
    this.pdfjs ??= import('pdfjs-dist').then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = 'assets/pdf.worker.min.mjs';
      return pdfjs;
    });
    return this.pdfjs;
  }

  async load(source: {
    data: ArrayBuffer;
    onProgress?: (progress: { loaded: number; total?: number }) => void;
  }): Promise<PdfDocumentRef> {
    const pdfjs = await this.module();
    // pdf.js takes ownership of the bytes it receives — pass a copy so the
    // caller's ArrayBuffer survives the transfer to the worker (ADR 0002).
    const task = pdfjs.getDocument({ data: new Uint8Array(source.data.slice(0)) });
    if (source.onProgress) {
      task.onProgress = (progress: { loaded: number; total?: number }) =>
        source.onProgress!(progress);
    }
    return new PdfJsDocument(await task.promise, task);
  }
}

class PdfJsDocument implements PdfDocumentRef {
  constructor(
    private readonly proxy: PDFDocumentProxy,
    private readonly task: PDFDocumentLoadingTask,
  ) {}

  get numPages(): number {
    return this.proxy.numPages;
  }

  async page(n: number): Promise<PdfPageRef> {
    return new PdfJsPage(await this.proxy.getPage(n));
  }

  destroy(): void {
    void this.task.destroy();
  }
}

class PdfJsPage implements PdfPageRef {
  constructor(private readonly proxy: PDFPageProxy) {}

  get width(): number {
    return this.proxy.getViewport({ scale: 1 }).width;
  }

  get height(): number {
    return this.proxy.getViewport({ scale: 1 }).height;
  }

  async render(canvas: HTMLCanvasElement, cssScale: number): Promise<void> {
    const dpr = globalThis.devicePixelRatio || 1;
    const viewport = this.proxy.getViewport({ scale: cssScale * dpr });
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    canvas.style.width = `${viewport.width / dpr}px`;
    canvas.style.height = `${viewport.height / dpr}px`;
    await this.proxy.render({ canvas, viewport }).promise;
  }
}
