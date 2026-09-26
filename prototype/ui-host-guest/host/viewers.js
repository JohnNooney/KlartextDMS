// PROTOTYPE ONLY — candidate PDF renderers for the Host's split reader.
// A: the browser's native viewer in an <iframe>. B: pdf.js, one page at a time.
// C: pdf.js, continuous scroll. Answers "PDF viewer in the Host" (issue #17).
import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { icon } from './icons.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export const VIEWER_LABELS = { A: 'Native', B: 'Paged', C: 'Scroll' };
export const DOC_SIMS = { ok: 'Normal', slow: 'Slow', large: 'Large 9.5 MB', corrupt: 'Corrupt' };

const SIMS = {
  ok: { url: '/sample.pdf', delay: 0 },
  slow: { url: '/sample.pdf', delay: 2400 },
  large: { url: '/large.pdf', delay: 0 },
  corrupt: { url: '/corrupt.pdf', delay: 0 },
};

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const pdfTasks = new Map();
function loadPdf(url, onProgress) {
  if (!pdfTasks.has(url)) pdfTasks.set(url, pdfjsLib.getDocument({ url }));
  const task = pdfTasks.get(url);
  if (onProgress) task.onProgress = onProgress;
  return task.promise.catch((e) => { pdfTasks.delete(url); throw e; });
}

function skeleton(n = 2) {
  const lines = '<div class="l"></div>'.repeat(14);
  return Array.from({ length: n }, () => `<div class="pdf-page pdf-skeleton">${lines}</div>`).join('');
}

function loadingTag(pct) {
  return `<div class="pdf-loading-tag"><span class="spinner"></span>${pct != null ? `Loading ${pct}%` : 'Loading preview…'}</div>`;
}

function errorCard(url, simKey) {
  return `<div class="pdf-error">
    ${icon('warning', 30)}
    <p class="pdf-error-title">Couldn’t open this PDF</p>
    <p class="pdf-error-sub">The file may be corrupted or not a real PDF.</p>
    <div class="pdf-error-actions">
      <button class="btn btn-primary" data-viewer-action="retry" data-sim="${simKey}">Try again</button>
      <a class="btn btn-secondary" href="${url}" target="_blank" rel="noopener">Open in browser</a>
    </div>
  </div>`;
}

class NativeViewer {
  constructor(mount, { doc, sim }) {
    this.mount = mount;
    this.doc = doc;
    this.sim = SIMS[sim] ?? SIMS.ok;
  }
  async start() {
    this.mount.innerHTML = `<div class="pdf-native">${loadingTag()}<iframe class="pdf-native-frame" title="PDF: ${esc(this.doc.name)}"></iframe></div>`;
    const frame = this.mount.querySelector('iframe');
    const tag = this.mount.querySelector('.pdf-loading-tag');
    frame.addEventListener('load', () => tag?.remove());
    await sleep(this.sim.delay);
    if (this.dead) return;
    frame.src = this.sim.url;
  }
  showPage(n) {
    const frame = this.mount.querySelector('iframe');
    if (frame) frame.src = `${this.sim.url}#page=${n}`;
  }
  destroy() { this.dead = true; }
}

class PdfjsBase {
  constructor(mount, { doc, sim, startPage, onPage }) {
    this.mount = mount;
    this.doc = doc;
    this.sim = SIMS[sim] ?? SIMS.ok;
    this.simKey = sim;
    this.page = startPage || 1;
    this.onPage = onPage;
    this.zoom = 1;
  }
  async load() {
    const stage = this.mount.querySelector('.pdf-load-here') ?? this.mount;
    try {
      await sleep(this.sim.delay);
      const task = loadPdf(this.sim.url, ({ loaded, total }) => {
        const el = this.mount.querySelector('.pdf-loading-tag');
        if (el && total) el.innerHTML = `<span class="spinner"></span>Loading ${Math.round((loaded / total) * 100)}%`;
      });
      this.pdf = await task;
      if (this.dead) return false;
      this.page = Math.min(Math.max(1, this.page), this.pdf.numPages);
      return true;
    } catch {
      if (!this.dead) stage.innerHTML = errorCard(this.sim.url, this.simKey);
      return false;
    }
  }
  setPage(n) {
    this.page = n;
    this.onPage?.(n);
  }
  destroy() { this.dead = true; }
}

class PagedViewer extends PdfjsBase {
  async start() {
    this.mount.innerHTML = `<div class="pdf-viewer">
      <div class="pdf-chrome">
        <button class="icon-btn" data-viewer-action="prev" aria-label="Previous page">${icon('chevronLeft')}</button>
        <span class="pdf-pageno" aria-live="polite">…</span>
        <button class="icon-btn" data-viewer-action="next" aria-label="Next page">${icon('chevronRight')}</button>
        <span class="pdf-chrome-sep"></span>
        <button class="icon-btn" data-viewer-action="zoom-out" aria-label="Zoom out">${icon('minus')}</button>
        <button class="icon-btn" data-viewer-action="zoom-in" aria-label="Zoom in">${icon('plus')}</button>
        <span class="pdf-chrome-flex"></span>
        <a class="icon-btn" href="${this.sim.url}" target="_blank" rel="noopener" title="Open in browser" aria-label="Open in browser">${icon('doc')}</a>
      </div>
      <div class="pdf-stage pdf-load-here">${skeleton(1)}${loadingTag()}</div>
    </div>`;
    this.bind();
    if (await this.load()) this.renderPage(this.page, { announce: false });
  }
  bind() {
    this.mount.addEventListener('click', (e) => {
      const t = e.target.closest('[data-viewer-action]');
      if (!t) return;
      const a = t.dataset.viewerAction;
      if (a === 'prev' && this.page > 1) this.renderPage(this.page - 1);
      if (a === 'next' && this.pdf && this.page < this.pdf.numPages) this.renderPage(this.page + 1);
      if (a === 'zoom-in') { this.zoom = Math.min(2.5, this.zoom + 0.2); this.renderPage(this.page); }
      if (a === 'zoom-out') { this.zoom = Math.max(0.5, this.zoom - 0.2); this.renderPage(this.page); }
      if (a === 'retry') location.reload();
    });
  }
  async renderPage(n, { announce = true, flash = false } = {}) {
    if (!this.pdf) return;
    this.setPage(n);
    const stage = this.mount.querySelector('.pdf-stage');
    const pageno = this.mount.querySelector('.pdf-pageno');
    pageno.textContent = `${n} / ${this.pdf.numPages}`;
    stage.innerHTML = `<div class="pdf-sheet" data-page="${n}"><canvas role="img" aria-label="Page ${n} of ${this.pdf.numPages}"></canvas></div>`;
    const sheet = stage.querySelector('.pdf-sheet');
    const canvas = sheet.querySelector('canvas');
    const page = await this.pdf.getPage(n);
    if (this.dead) return;
    const fit = (stage.clientWidth - 48) / page.getViewport({ scale: 1 }).width;
    const scale = Math.min(fit, 1.4) * this.zoom;
    const vp = page.getViewport({ scale: scale * window.devicePixelRatio });
    canvas.width = vp.width;
    canvas.height = vp.height;
    canvas.style.width = `${vp.width / window.devicePixelRatio}px`;
    await page.render({ canvas, viewport: vp }).promise;
    if (flash) { sheet.classList.add('is-target'); setTimeout(() => sheet.classList.remove('is-target'), 1800); }
    this.mount.querySelector('[data-viewer-action="prev"]').disabled = n <= 1;
    this.mount.querySelector('[data-viewer-action="next"]').disabled = n >= this.pdf.numPages;
    if (announce) pageno.setAttribute('aria-label', `Page ${n} of ${this.pdf.numPages}`);
  }
  showPage(n) {
    if (!this.pdf) { this.page = n; return; }
    this.renderPage(Math.min(Math.max(1, n), this.pdf.numPages), { flash: true });
  }
}

class ScrollViewer extends PdfjsBase {
  async start() {
    this.mount.innerHTML = `<div class="pdf-viewer">
      <div class="pdf-scroll pdf-cont-scroll" role="document" aria-label="PDF: ${esc(this.doc.name)}">
        <div class="pdf-load-here">${skeleton(3)}${loadingTag()}</div>
      </div>
      <div class="pdf-float">
        <button class="icon-btn" data-viewer-action="zoom-out" aria-label="Zoom out">${icon('minus')}</button>
        <span class="pdf-chip" aria-live="polite">–</span>
        <button class="icon-btn" data-viewer-action="zoom-in" aria-label="Zoom in">${icon('plus')}</button>
        <a class="icon-btn" href="${this.sim.url}" target="_blank" rel="noopener" title="Open in browser" aria-label="Open in browser">${icon('doc')}</a>
      </div>
    </div>`;
    this.bind();
    if (!(await this.load())) return;
    const scroller = this.mount.querySelector('.pdf-cont-scroll');
    const holder = this.mount.querySelector('.pdf-load-here');
    holder.outerHTML = Array.from({ length: this.pdf.numPages }, (_, i) =>
      `<div class="pdf-sheet" data-page="${i + 1}"><canvas role="img" aria-label="Page ${i + 1} of ${this.pdf.numPages}"></canvas></div>`).join('');
    const first = await this.pdf.getPage(1);
    const base = first.getViewport({ scale: 1 });
    this.aspect = base.height / base.width;
    this.observe(scroller);
    this.renderVisible();
    if (this.page > 1) scroller.querySelector(`[data-page="${this.page}"]`)?.scrollIntoView();
  }
  bind() {
    this.mount.addEventListener('click', (e) => {
      const t = e.target.closest('[data-viewer-action]');
      if (!t) return;
      const a = t.dataset.viewerAction;
      if (a === 'zoom-in') { this.zoom = Math.min(2.5, this.zoom + 0.2); this.renderVisible(true); }
      if (a === 'zoom-out') { this.zoom = Math.max(0.5, this.zoom - 0.2); this.renderVisible(true); }
      if (a === 'retry') location.reload();
    });
    this.mount.querySelector('.pdf-cont-scroll').addEventListener('scroll', () => this.renderVisible());
  }
  observe(scroller) {
    this.observer = new IntersectionObserver((entries) => {
      let best = null;
      for (const en of entries) if (en.isIntersecting && (!best || en.intersectionRatio > best.intersectionRatio)) best = en;
      if (best) {
        const n = Number(best.target.dataset.page);
        this.mount.querySelector('.pdf-chip').textContent = `${n} / ${this.pdf.numPages}`;
        this.setPage(n);
      }
      this.renderVisible();
    }, { root: scroller, threshold: [0.4] });
    scroller.querySelectorAll('.pdf-sheet').forEach((el) => this.observer.observe(el));
  }
  async renderVisible(force = false) {
    if (!this.pdf) return;
    const scroller = this.mount.querySelector('.pdf-cont-scroll');
    const w = Math.min(scroller.clientWidth - 48, 640);
    for (const sheet of scroller.querySelectorAll('.pdf-sheet')) {
      const n = Number(sheet.dataset.page);
      if (!force && sheet.dataset.rendered === String(this.zoom)) continue;
      const r = sheet.getBoundingClientRect(), sr = scroller.getBoundingClientRect();
      if (!force && (r.bottom < sr.top - 400 || r.top > sr.bottom + 400)) { sheet.dataset.rendered = ''; sheet.style.height = `${w * this.aspect}px`; continue; }
      sheet.dataset.rendered = String(this.zoom);
      const page = await this.pdf.getPage(n);
      if (this.dead) return;
      const scale = (w / page.getViewport({ scale: 1 }).width) * this.zoom;
      const vp = page.getViewport({ scale: scale * window.devicePixelRatio });
      const canvas = sheet.querySelector('canvas');
      canvas.width = vp.width;
      canvas.height = vp.height;
      sheet.style.height = '';
      canvas.style.width = `${vp.width / window.devicePixelRatio}px`;
      await page.render({ canvas, viewport: vp }).promise;
    }
  }
  showPage(n) {
    const target = this.mount.querySelector(`[data-page="${Math.min(Math.max(1, n), this.pdf?.numPages ?? n)}"]`);
    if (!target) { this.page = n; return; }
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    target.classList.add('is-target');
    setTimeout(() => target.classList.remove('is-target'), 1800);
  }
  destroy() { this.dead = true; this.observer?.disconnect(); }
}

export function createViewer(mount, opts) {
  const v = opts.viewer === 'A' ? new NativeViewer(mount, opts)
    : opts.viewer === 'C' ? new ScrollViewer(mount, opts)
    : new PagedViewer(mount, opts);
  v.start();
  return v;
}
