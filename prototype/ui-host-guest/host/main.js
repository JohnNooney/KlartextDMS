// PROTOTYPE ONLY — throwaway Host for "Host and Guest UI prototype". See index.html header comment.
import '../shared/theme.css';
import './styles.scss';
import { icon, docThumb, folderThumb } from './icons.js';

const GUEST_ORIGIN = 'http://localhost:5174';
const ROOT_LABEL = 'Documents';
const NAVS = { A: 'Breadcrumbs', B: 'Focus + back', C: 'Columns' };
const GUEST_STATES = { auto: 'Auto', loading: 'Analyzing', complete: 'Complete', insufficient: 'Unreadable', error: 'Error' };

// ---------- Hardcoded data (no Firebase) ----------
const folders = [
  { id: 'vertraege', name: 'Verträge', parentId: null },
  { id: 'wohnung', name: 'Wohnung', parentId: 'vertraege' },
  { id: 'internet', name: 'Internet & Mobilfunk', parentId: 'vertraege' },
  { id: 'versicherungen', name: 'Versicherungen', parentId: null },
  { id: 'kranken', name: 'Krankenversicherung', parentId: 'versicherungen' },
  { id: 'behoerden', name: 'Behörden', parentId: null },
];

const extractions = {
  f1: {
    documentType: 'TENANCY_AGREEMENT', label: 'Tenancy agreement', sourceLanguage: 'German', extractionStatus: 'COMPLETE', model: 'gemini-2.5-flash', createdAt: '15 Mar 2024',
    plainEnglishSummary: 'An open-ended rental agreement for a two-room flat in Berlin-Neukölln, starting 1 April 2024. Rent is €890 per month plus €210 in advance service charges. Either side can end it in writing; your notice period is three months.',
    keyTakeaways: [
      { text: 'To move out you must give three months’ notice in writing, on paper. Email does not count.', importance: 'CRITICAL', sourceQuote: 'Die Kündigung bedarf der Schriftform. Die Kündigungsfrist beträgt drei Monate.', page: 3 },
      { text: 'A deposit of €2,670 (three months’ cold rent) is due. You may pay it in three instalments.', importance: 'CRITICAL', sourceQuote: 'Der Mieter leistet eine Kaution in Höhe von 2.670 €, zahlbar in drei Raten.', page: 2 },
      { text: 'Rent is due by the third working day of each month.', importance: 'NORMAL', sourceQuote: 'Die Miete ist spätestens am dritten Werktag eines jeden Monats zu zahlen.', page: 2 },
      { text: 'Service charges are settled once a year, so you may owe a top-up.', importance: 'NORMAL', sourceQuote: 'Über die Vorauszahlungen wird jährlich abgerechnet.', page: 2 },
      { text: 'You pay for small repairs up to €100 each, capped at €300 a year.', importance: 'NORMAL', sourceQuote: 'Kleinreparaturen bis zu 100 € im Einzelfall, höchstens 300 € jährlich.', page: 4 },
    ],
  },
  f2: {
    documentType: 'TENANCY_AGREEMENT', label: 'Service charge statement', sourceLanguage: 'German', extractionStatus: 'COMPLETE', model: 'gemini-2.5-flash', createdAt: '02 Feb 2024',
    plainEnglishSummary: 'Your landlord’s annual statement of service charges for 2023. Actual costs were €2,784 against €2,520 you paid in advance, so you owe €264.',
    keyTakeaways: [
      { text: 'You owe a top-up of €264, payable within 30 days of this letter.', importance: 'CRITICAL', sourceQuote: 'Nachzahlung: 264,00 € – zahlbar innerhalb von 30 Tagen.', page: 1 },
      { text: 'Your monthly advance rises to €232 from March.', importance: 'NORMAL', sourceQuote: 'Ab März beträgt die Vorauszahlung 232,00 € monatlich.', page: 2 },
    ],
  },
  f3: {
    documentType: 'INTERNET_OR_PHONE', label: 'Internet contract', sourceLanguage: 'German', extractionStatus: 'COMPLETE', model: 'gemini-2.5-flash', createdAt: 'Yesterday',
    plainEnglishSummary: 'A 24-month fibre internet contract at €39.95 per month, with the first six months at €19.95. It renews monthly after the minimum term.',
    keyTakeaways: [
      { text: 'The price jumps from €19.95 to €39.95 after six months.', importance: 'CRITICAL', sourceQuote: 'ab dem 7. Monat 39,95 € monatlich', page: 1 },
      { text: 'After 24 months you can cancel with one month’s notice.', importance: 'NORMAL', sourceQuote: 'danach monatlich mit einer Frist von einem Monat kündbar', page: 2 },
    ],
  },
  f4: {
    documentType: 'HEALTH_INSURANCE', label: 'Health insurance notice', sourceLanguage: 'German', extractionStatus: 'COMPLETE', model: 'gemini-2.5-flash', createdAt: '02 Jun 2024',
    plainEnglishSummary: 'Your health insurer confirms your membership and announces a higher additional contribution from January. Because of the increase you have a special right to switch insurer.',
    keyTakeaways: [
      { text: 'Your contribution rises by 0.4 percentage points from 1 January. You can switch insurer until 31 January.', importance: 'CRITICAL', sourceQuote: 'Sonderkündigungsrecht bis zum 31. Januar', page: 1 },
      { text: 'Professional teeth cleaning is reimbursed up to €80 a year.', importance: 'NORMAL', sourceQuote: 'Professionelle Zahnreinigung bis zu 80 € jährlich', page: 2 },
    ],
  },
  f5: {
    documentType: 'GOVERNMENT_LETTER', label: 'Tax office letter', sourceLanguage: 'German', extractionStatus: 'COMPLETE', model: 'gemini-2.5-flash', createdAt: '3 hours ago',
    plainEnglishSummary: 'The tax office reminds you to file your 2023 income tax return. No tax is being assessed yet.',
    keyTakeaways: [
      { text: 'File your 2023 tax return by 31 July 2024, or a late-filing fee may be charged.', importance: 'CRITICAL', sourceQuote: 'bis zum 31.07.2024 … Verspätungszuschlag', page: 1 },
    ],
  },
  f6: {
    documentType: 'OTHER', label: 'Unknown', sourceLanguage: 'German', extractionStatus: 'INSUFFICIENT_CONTENT', model: 'gemini-2.5-flash', createdAt: 'Today',
    statusExplanation: 'The scan is too blurry to read reliably. Try a sharper scan or the original PDF.', plainEnglishSummary: '', keyTakeaways: [],
  },
};

const files = [
  { id: 'f1', name: 'Mietvertrag 2024.pdf', folderId: 'wohnung', size: 1_240_000, date: '15 Mar 2024', status: 'ready', pages: 4 },
  { id: 'f2', name: 'Nebenkostenabrechnung 2023.pdf', folderId: 'wohnung', size: 420_000, date: '02 Feb 2024', status: 'ready', pages: 2 },
  { id: 'f3', name: 'Internetvertrag Telekom.pdf', folderId: 'internet', size: 560_000, date: 'Yesterday', status: 'ready', pages: 2 },
  { id: 'f4', name: 'Versicherungsschein TK.pdf', folderId: 'kranken', size: 890_000, date: '02 Jun 2024', status: 'ready', pages: 2 },
  { id: 'f5', name: 'Brief vom Finanzamt.pdf', folderId: null, size: 210_000, date: '3 hours ago', status: 'ready', pages: 1 },
  { id: 'f6', name: 'Scan 0412.pdf', folderId: null, size: 3_100_000, date: 'Today', status: 'ready', pages: 1 },
];

function genericExtraction(doc) {
  return {
    documentType: 'OTHER', label: 'Letter', sourceLanguage: 'German', extractionStatus: 'COMPLETE', model: 'gemini-2.5-flash', createdAt: 'Just now',
    plainEnglishSummary: `A letter (“${stripExt(doc.name)}”) asking you to confirm your details and reply within two weeks.`,
    keyTakeaways: [
      { text: 'Reply within 14 days of the letter date.', importance: 'CRITICAL', sourceQuote: 'Bitte antworten Sie innerhalb von 14 Tagen.', page: 1 },
      { text: 'You can reply by post or online.', importance: 'NORMAL', sourceQuote: 'per Post oder online', page: 1 },
    ],
  };
}

// ---------- State (mirrored in the URL) ----------
const state = { folderId: null, fileId: null, nav: 'A', panel: true, sheet: 'half', menu: null, dialog: null, guestForce: 'auto', page: null };
let seq = 100;
let uploads = [];
let uploadFolderId = null;
let draft = { name: '', desc: '', keyword: '', keywords: [] };

const mq = matchMedia('(max-width: 768px)');
const isMobile = () => mq.matches;
const mode = () => (isMobile() ? 'B' : state.nav);

function readUrl() {
  const p = new URLSearchParams(location.search);
  state.folderId = p.get('folder') || null;
  state.fileId = p.get('file') || null;
  state.nav = NAVS[p.get('nav')] ? p.get('nav') : 'A';
}

function writeUrl(replace) {
  const p = new URLSearchParams();
  if (state.folderId) p.set('folder', state.folderId);
  if (state.fileId) p.set('file', state.fileId);
  p.set('nav', state.nav);
  history[replace ? 'replaceState' : 'pushState'](null, '', `?${p}`);
}

function go(patch, { replace = false } = {}) {
  Object.assign(state, { menu: null }, patch);
  writeUrl(replace);
  render();
}

function openFile(id) {
  const doc = files.find((f) => f.id === id);
  if (doc) go({ fileId: id, folderId: doc.folderId, page: null, sheet: 'half', dialog: null });
}

// ---------- Helpers ----------
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
function stripExt(name) { return name.replace(/\.pdf$/i, ''); }
const folderById = (id) => folders.find((f) => f.id === id);
const childFolders = (id) => folders.filter((f) => f.parentId === (id ?? null));
const filesIn = (id) => files.filter((f) => f.folderId === (id ?? null));
const countDeep = (id) => filesIn(id).length + childFolders(id).reduce((n, c) => n + countDeep(c.id), 0);
const currentFile = () => files.find((f) => f.id === state.fileId) ?? null;
const extractionFor = (doc) => (doc.status === 'ready' ? extractions[doc.id] ?? null : null);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function formatSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ancestry(folderId = state.folderId) {
  const out = [];
  for (let f = folderById(folderId); f; f = folderById(f.parentId)) out.unshift({ id: f.id, label: f.name });
  return [{ id: null, label: ROOT_LABEL }, ...out];
}

function flatTree(parentId = null, depth = 0) {
  return childFolders(parentId).flatMap((f) => [{ ...f, depth }, ...flatTree(f.id, depth + 1)]);
}

// ---------- Pieces ----------
function sidebar() {
  const rows = flatTree().map((f) => {
    const active = f.id === state.folderId;
    return `<button class="side-item ${active ? 'is-active' : ''}" style="--depth:${f.depth}" data-action="folder" data-folder="${f.id}" ${active ? 'aria-current="page"' : ''}>${icon('folder')}<span>${esc(f.name)}</span></button>`;
  }).join('');
  return `<aside class="sidebar">
    <div class="brand"><span class="brand-mark">K</span><span>Klartext</span></div>
    <nav class="side-nav" aria-label="Library">
      <button class="side-item ${!state.folderId ? 'is-active' : ''}" data-action="folder" data-folder="">${icon('tray')}<span>${ROOT_LABEL}</span></button>
      <p class="side-label">Folders</p>
      ${rows}
    </nav>
    <button class="side-item side-new" data-action="new-folder">${icon('plus')}<span>New folder</span></button>
  </aside>`;
}

function breadcrumbs(file, { compact = false } = {}) {
  let items = ancestry().map((a) => ({ ...a, kind: 'folder' }));
  if (file) items.push({ label: file.name, kind: 'file' });
  if (items.length > 4) items = [items[0], { kind: 'more' }, ...items.slice(-2)];
  const last = items.length - 1;
  const lis = items.map((it, i) => {
    const sep = i ? `<span class="crumb-sep">${icon('chevronRight', 14)}</span>` : '';
    let el;
    if (it.kind === 'more') el = `<span class="menu-anchor"><button class="crumb" data-action="menu" data-menu="path" aria-label="Show full path">…</button>${state.menu === 'path' ? pathMenu(file) : ''}</span>`;
    else if (i === last) el = `<span class="crumb is-current" aria-current="page">${esc(it.label)}</span>`;
    else el = `<button class="crumb" data-action="folder" data-folder="${it.id ?? ''}">${esc(it.label)}</button>`;
    return `<li>${sep}${el}</li>`;
  }).join('');
  return `<nav class="crumbs ${compact || file ? 'crumbs-compact' : ''}" aria-label="Breadcrumb"><ol>${lis}</ol></nav>`;
}

function pathMenu(file) {
  const chain = ancestry().reverse();
  const current = file ? `<div class="menu-item is-current">${icon('doc')}<span>${esc(file.name)}</span></div>` : '';
  const rows = chain.map((a, i) => {
    const isHere = !file && i === 0;
    const ico = a.id ? 'folder' : 'tray';
    return isHere
      ? `<div class="menu-item is-current">${icon(ico)}<span>${esc(a.label)}</span></div>`
      : `<button class="menu-item" role="menuitem" data-action="folder" data-folder="${a.id ?? ''}">${icon(ico)}<span>${esc(a.label)}</span></button>`;
  }).join('');
  return `<div class="menu path-menu" role="menu">${current}${rows}</div>`;
}

function backTarget(file) {
  if (file) {
    const f = folderById(state.folderId);
    return { id: f?.id ?? null, label: f?.name ?? ROOT_LABEL };
  }
  if (!state.folderId) return null;
  const parent = folderById(folderById(state.folderId).parentId);
  return { id: parent?.id ?? null, label: parent?.name ?? ROOT_LABEL };
}

function focusTitle(file) {
  const back = backTarget(file);
  const label = file ? file.name : folderById(state.folderId)?.name ?? ROOT_LABEL;
  const hasPath = Boolean(file || state.folderId);
  return `<div class="title-row ${file ? 'is-file' : ''}">
    ${back ? `<button class="back-btn" data-action="folder" data-folder="${back.id ?? ''}">${icon('chevronLeft', 22)}<span>${esc(back.label)}</span></button>` : ''}
    <div class="menu-anchor path-title">
      <button class="path-title-btn" ${hasPath ? 'data-action="menu" data-menu="path" aria-haspopup="menu"' : 'disabled'} title="${hasPath ? 'Show where this is' : ''}">
        <span class="${file ? 'title-file' : 'title-large'}">${esc(label)}</span>${hasPath ? icon('chevronDown', 14) : ''}
      </button>
      ${state.menu === 'path' ? pathMenu(file) : ''}
    </div>
  </div>`;
}

function statusMeta(doc) {
  if (doc.status === 'processing') return `<span class="spinner"></span>Analyzing…`;
  const ex = extractionFor(doc);
  if (ex?.extractionStatus === 'INSUFFICIENT_CONTENT') return `<span class="meta-warn">Couldn’t read</span>`;
  const crit = ex?.keyTakeaways.filter((k) => k.importance === 'CRITICAL').length ?? 0;
  return `${esc(doc.date)}${crit ? `<span class="crit-count" title="${plural(crit, 'critical warning')}">${icon('warning', 12)}${crit}</span>` : ''}`;
}

function docMenu(doc) {
  return `<div class="menu" role="menu">
    <button class="menu-item" role="menuitem" data-action="todo" data-what="Rename">${icon('pencil', 16)}<span>Rename</span></button>
    <button class="menu-item" role="menuitem" data-action="todo" data-what="Move">${icon('move', 16)}<span>Move to…</span></button>
    <div class="menu-sep"></div>
    <button class="menu-item is-destructive" role="menuitem" data-action="todo" data-what="Delete">${icon('trash', 16)}<span>Delete</span></button>
  </div>`;
}

function folderTile(f) {
  const n = countDeep(f.id);
  return `<button class="tile tile-folder" data-action="folder" data-folder="${f.id}">
    <span class="tile-thumb">${folderThumb()}</span>
    <span class="tile-name" lang="de">${esc(f.name)}</span>
    <span class="tile-meta">${plural(n, 'document')}</span>
    <span class="tile-chevron">${icon('chevronRight', 16)}</span>
  </button>`;
}

function docTile(doc) {
  const key = `tile:${doc.id}`;
  const open = state.menu === key;
  return `<div class="tile tile-doc ${open ? 'has-menu' : ''}" data-action="open" data-file="${doc.id}" role="button" tabindex="0" aria-label="Open ${esc(doc.name)}">
    <button class="tile-more" data-action="menu" data-menu="${key}" aria-label="More actions for ${esc(doc.name)}">${icon('ellipsis')}</button>
    <span class="tile-thumb">${docThumb()}${doc.status === 'processing' ? '<span class="thumb-badge"><span class="spinner"></span></span>' : ''}</span>
    <span class="tile-name" lang="de">${esc(stripExt(doc.name))}</span>
    <span class="tile-meta">${statusMeta(doc)}</span>
    ${open ? docMenu(doc) : ''}
  </div>`;
}

function browseActions() {
  if (isMobile()) {
    return `<div class="menu-anchor"><button class="icon-btn icon-btn-accent" data-action="menu" data-menu="add" aria-label="Add">${icon('plus', 22)}</button>
      ${state.menu === 'add' ? `<div class="menu" role="menu">
        <button class="menu-item" data-action="upload">${icon('upload', 16)}<span>Upload documents</span></button>
        <button class="menu-item" data-action="new-folder">${icon('folderPlus', 16)}<span>New folder</span></button>
      </div>` : ''}</div>`;
  }
  return `<button class="btn btn-secondary" data-action="new-folder">${icon('folderPlus', 16)}New folder</button>
    <button class="btn btn-primary" data-action="upload">${icon('upload', 16)}Upload</button>`;
}

function browser(m) {
  const subs = childFolders(state.folderId);
  const list = filesIn(state.folderId);
  const total = countDeep(state.folderId);
  return `<header class="toolbar toolbar-browse">
      ${m === 'B' ? focusTitle(null) : breadcrumbs(null)}
      <div class="toolbar-actions">${browseActions()}</div>
    </header>
    <div class="scroll">
      <p class="meta-line">${plural(total, 'document')}${subs.length ? ` · ${plural(subs.length, 'folder')}` : ''}</p>
      ${subs.length ? `<h2 class="section-label">Folders</h2><div class="grid">${subs.map(folderTile).join('')}</div>` : ''}
      <h2 class="section-label">Documents</h2>
      ${list.length ? `<div class="grid">${list.map(docTile).join('')}</div>` : `<div class="empty">${folderThumb(64)}<p class="empty-title">No documents here yet</p><p>Upload a PDF and Klartext will explain it in plain English.</p><button class="btn btn-tinted" data-action="upload">${icon('upload', 16)}Upload</button></div>`}
    </div>`;
}

function pdfMock(doc) {
  const pages = Array.from({ length: doc.pages ?? 2 }, (_, i) => `
    <div class="pdf-page ${state.page === i + 1 ? 'is-target' : ''}" id="page-${i + 1}">
      ${i === 0 ? '<div class="l h"></div>' : ''}${'<div class="l"></div>'.repeat(i === 0 ? 12 : 16)}<div class="l s"></div>
      <span class="pdf-page-no">${i + 1}</span>
    </div>`).join('');
  return `<div class="pdf-scroll" id="pdf-scroll" aria-label="PDF preview (placeholder)">${pages}</div>`;
}

function reader(doc, m) {
  const sibs = filesIn(doc.folderId);
  const idx = sibs.findIndex((s) => s.id === doc.id);
  const title = m === 'A' ? breadcrumbs(doc) : m === 'B' ? focusTitle(doc) : `<h1 class="reader-title">${esc(doc.name)}</h1>`;
  const stepper = m === 'B' && !isMobile() && sibs.length > 1
    ? `<div class="stepper">
        <button class="icon-btn" data-action="open" data-file="${sibs[idx - 1]?.id ?? ''}" ${idx <= 0 ? 'disabled' : ''} aria-label="Previous document">${icon('chevronLeft')}</button>
        <span class="stepper-label">${idx + 1} of ${sibs.length}</span>
        <button class="icon-btn" data-action="open" data-file="${sibs[idx + 1]?.id ?? ''}" ${idx >= sibs.length - 1 ? 'disabled' : ''} aria-label="Next document">${icon('chevronRight')}</button>
      </div>` : '';
  const panelBtn = isMobile()
    ? `<button class="btn btn-tinted" data-action="sheet-open">Insights</button>`
    : `<button class="icon-btn ${state.panel ? 'is-on' : ''}" data-action="toggle-panel" aria-pressed="${state.panel}" title="${state.panel ? 'Hide' : 'Show'} insights">${icon('sidebarRight')}</button>`;
  const key = `reader:${doc.id}`;
  const close = m === 'C' ? `<button class="icon-btn" data-action="folder" data-folder="${doc.folderId ?? ''}" aria-label="Close document">${icon('xmark')}</button>` : '';
  return `<header class="toolbar toolbar-reader">
      ${title}
      <div class="toolbar-actions">
        ${stepper}${panelBtn}
        <div class="menu-anchor"><button class="icon-btn" data-action="menu" data-menu="${key}" aria-label="More actions">${icon('ellipsis')}</button>${state.menu === key ? docMenu(doc) : ''}</div>
        ${close}
      </div>
    </header>
    <div class="split">
      <div class="pdf-pane">${pdfMock(doc)}</div>
      <div class="insights-slot" id="insights-slot"></div>
    </div>`;
}

function listColumn() {
  const rows = filesIn(state.folderId).map((d) => `
    <button class="list-row ${d.id === state.fileId ? 'is-selected' : ''}" data-action="open" data-file="${d.id}">
      ${docThumb(22)}
      <span class="list-text"><span class="list-name">${esc(stripExt(d.name))}</span><span class="list-meta">${statusMeta(d)}</span></span>
    </button>`).join('');
  return `<aside class="list-col"><header class="list-head">${breadcrumbs(null, { compact: true })}</header><div class="list">${rows}</div></aside>`;
}

// ---------- Dialogs ----------
function uploadDialog() {
  const options = [{ id: '', name: ROOT_LABEL, depth: -1 }, ...flatTree()].map((f) =>
    `<option value="${f.id}" ${String(uploadFolderId ?? '') === f.id ? 'selected' : ''}>${'\u2003'.repeat(f.depth + 1)}${esc(f.name)}</option>`).join('');
  const rows = uploads.map((u) => {
    const done = u.progress >= 100;
    return `<li class="upload-row">
      ${docThumb(22)}
      <div class="upload-body">
        <div class="upload-name">${esc(u.name)}</div>
        <div class="upload-meta">${formatSize(u.size)} · ${done ? 'Uploaded — analyzing in the background' : `${u.progress}%`}</div>
        ${done ? '' : `<div class="progress"><span style="width:${u.progress}%"></span></div>`}
      </div>
      ${done ? `<span class="upload-done">${icon('checkCircle', 20)}</span>` : `<button class="close-btn" data-action="upload-cancel" data-id="${u.id}" aria-label="Cancel upload">${icon('xmark', 14)}</button>`}
    </li>`;
  }).join('');
  return `<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
    <header class="dialog-head"><h2 id="dlg-title">Upload documents</h2><button class="close-btn" data-action="dialog-close" aria-label="Close">${icon('xmark', 14)}</button></header>
    <label class="field-inline"><span>Save to</span><select id="upload-folder">${options}</select></label>
    <div class="drop-zone" id="drop-zone">
      <span class="drop-icon">${icon('upload', 22)}</span>
      <p class="drop-title">Drag PDFs here</p>
      <p class="drop-hint">PDF only · up to 10 MB each</p>
      <button class="btn btn-primary" data-action="browse">Choose files…</button>
      <button class="link-btn" data-action="sample-upload">Add a sample PDF (prototype)</button>
      <input type="file" id="file-input" accept="application/pdf" multiple hidden />
    </div>
    ${uploads.length ? `<ul class="upload-list">${rows}</ul>` : ''}
    <footer class="dialog-foot"><button class="btn btn-primary" data-action="dialog-close">Done</button></footer>
  </div>`;
}

function folderDialog() {
  const where = ancestry().map((a) => esc(a.label)).join(' › ');
  return `<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
    <header class="dialog-head"><h2 id="dlg-title">New folder</h2><button class="close-btn" data-action="dialog-close" aria-label="Close">${icon('xmark', 14)}</button></header>
    <p class="dialog-sub">Makes it easier to <strong>find</strong>, <strong>organize</strong>, and <strong>manage</strong> your documents.</p>
    <p class="location">${icon('folder', 16)}In ${where}</p>
    <label class="field"><span>Name</span><input id="folder-name" data-draft="name" value="${esc(draft.name)}" placeholder="e.g. Arbeit" autocomplete="off" /></label>
    <label class="field"><span>Description <em>optional</em></span><textarea data-draft="desc" rows="2" placeholder="What belongs in this folder?">${esc(draft.desc)}</textarea></label>
    <div class="field"><span>Keywords <em>optional</em></span>
      <div class="keyword-field"><input id="folder-keyword" data-draft="keyword" value="${esc(draft.keyword)}" placeholder="Add a keyword and press Return" autocomplete="off" />
      <button class="inline-add" data-action="add-keyword" aria-label="Add keyword">${icon('plus', 16)}</button></div>
      ${draft.keywords.length ? `<div class="tags">${draft.keywords.map((k, i) => `<span class="tag">${esc(k)}<button data-action="remove-keyword" data-index="${i}" aria-label="Remove ${esc(k)}">${icon('xmark', 12)}</button></span>`).join('')}</div>` : ''}
    </div>
    <footer class="dialog-foot">
      <button class="btn btn-secondary" data-action="dialog-close">Cancel</button>
      <button class="btn btn-primary" id="create-folder" data-action="create-folder" ${draft.name.trim() ? '' : 'disabled'}>Create</button>
    </footer>
  </div>`;
}

function renderOverlays() {
  const root = document.getElementById('overlay-root');
  if (!state.dialog) { root.innerHTML = ''; return; }
  const active = document.activeElement?.id;
  root.innerHTML = `<div class="backdrop" data-action="dialog-close"></div>${state.dialog === 'upload' ? uploadDialog() : folderDialog()}`;
  if (active) document.getElementById(active)?.focus();
}

// ---------- Uploads / processing ----------
function startUpload(name, size) {
  const u = { id: ++seq, name, size, progress: 0 };
  uploads.push(u);
  const folderId = uploadFolderId;
  const timer = setInterval(() => {
    if (!uploads.includes(u)) return clearInterval(timer);
    u.progress = Math.min(100, u.progress + 12 + Math.round(Math.random() * 10));
    if (u.progress < 100) return renderOverlays();
    clearInterval(timer);
    const doc = { id: `u${u.id}`, name, folderId, size, date: 'Just now', status: 'processing', pages: 2 };
    files.push(doc);
    render();
    scheduleAnalysis(doc, 6000);
  }, 300);
  renderOverlays();
}

function scheduleAnalysis(doc, ms) {
  setTimeout(() => {
    doc.status = 'ready';
    extractions[doc.id] ??= genericExtraction(doc);
    render();
    const crit = extractions[doc.id].keyTakeaways.filter((k) => k.importance === 'CRITICAL').length;
    toast({ title: 'Analysis complete', body: `${stripExt(doc.name)}${crit ? ` · ${plural(crit, 'critical warning')}` : ''}`, file: doc.id });
  }, ms);
}

function toast({ title, body, file, tone = 'success' }) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.innerHTML = `<span class="toast-icon ${tone}">${icon(tone === 'success' ? 'checkCircle' : 'doc', 22)}</span>
    <div class="toast-text"><strong>${esc(title)}</strong>${body ? `<span>${esc(body)}</span>` : ''}</div>
    ${file ? `<button class="btn btn-tinted btn-sm" data-action="open" data-file="${file}">View</button>` : ''}`;
  document.getElementById('toasts').append(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 6500);
}

// ---------- Guest (smart panel) over the Bus ----------
const insights = document.getElementById('insights');
const frame = document.getElementById('guest-frame');
let guestDoc = null;
let guestReady = false;
let sessionId = null;

function post(type, payload) {
  frame.contentWindow?.postMessage({ v: 1, type, sessionId, payload }, GUEST_ORIGIN);
}

function sendSession() {
  const doc = files.find((f) => f.id === guestDoc);
  if (doc && guestReady) post('INIT_SESSION', { documentId: doc.id, title: doc.name, status: doc.status, extraction: extractionFor(doc), force: state.guestForce });
}

function syncGuest(doc) {
  if (!doc) return;
  if (guestDoc !== doc.id) {
    guestDoc = doc.id;
    guestReady = false;
    sessionId = `s-${++seq}`;
    frame.src = `${GUEST_ORIGIN}/?session=${sessionId}`;
  } else sendSession();
}

function positionInsights() {
  const doc = currentFile();
  const sheet = isMobile();
  insights.classList.toggle('as-sheet', sheet);
  insights.classList.toggle('is-visible', Boolean(doc) && (sheet ? state.sheet !== 'closed' : state.panel));
  insights.dataset.detent = state.sheet;
  const slot = document.getElementById('insights-slot');
  if (sheet || !slot) { insights.removeAttribute('style'); return; }
  const r = slot.getBoundingClientRect();
  Object.assign(insights.style, { top: `${r.top}px`, left: `${r.left + 1}px`, width: `${r.width - 1}px`, height: `${r.height}px` });
}

window.addEventListener('message', (e) => {
  if (e.origin !== GUEST_ORIGIN || e.source !== frame.contentWindow) return;
  const msg = e.data;
  if (msg?.v !== 1) return;
  if (msg.type === 'GUEST_READY') { guestReady = true; sendSession(); }
  if (msg.type === 'GUEST_SHOW_PAGE') {
    state.page = msg.payload.page;
    if (isMobile()) state.sheet = 'closed';
    render();
    document.getElementById(`page-${state.page}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  if (msg.type === 'GUEST_RETRY') {
    const doc = currentFile();
    if (!doc) return;
    state.guestForce = 'auto';
    doc.status = 'processing';
    render();
    scheduleAnalysis(doc, 4000);
  }
});

// ---------- Prototype switcher bar ----------
function renderProtoBar() {
  if (import.meta.env.PROD) return;
  document.getElementById('proto-bar').innerHTML = `<div class="proto-bar" role="toolbar" aria-label="Prototype controls">
    <span class="proto-tag">Prototype</span>
    <button class="proto-arrow" data-action="nav-step" data-dir="-1" aria-label="Previous variant">‹</button>
    <span class="proto-label">${isMobile() ? 'Mobile (B-style)' : `${state.nav} · ${NAVS[state.nav]}`}</span>
    <button class="proto-arrow" data-action="nav-step" data-dir="1" aria-label="Next variant">›</button>
    <span class="proto-div"></span><span class="proto-sub">Guest</span>
    <div class="proto-seg">${Object.entries(GUEST_STATES).map(([k, l]) => `<button class="${state.guestForce === k ? 'on' : ''}" data-action="guest-force" data-state="${k}">${l}</button>`).join('')}</div>
  </div>`;
}

// ---------- Render ----------
function render() {
  const m = mode();
  const doc = currentFile();
  const app = document.getElementById('app');
  const showSidebar = !isMobile() && !(m === 'B' && doc);
  app.className = `app nav-${m} ${doc ? 'is-reading' : 'is-browsing'} ${isMobile() ? 'is-mobile' : ''} ${state.panel ? '' : 'panel-hidden'}`;
  const body = !doc ? browser(m) : m === 'C' ? `<div class="columns">${listColumn()}<section class="reader-col">${reader(doc, m)}</section></div>` : reader(doc, m);
  app.innerHTML = `${showSidebar ? sidebar() : ''}<main class="main"><div class="canvas-panel">${body}</div></main>`;
  renderOverlays();
  renderProtoBar();
  syncGuest(doc);
  requestAnimationFrame(positionInsights);
}

// ---------- Events ----------
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-action]');
  if (!t) { if (state.menu) { state.menu = null; render(); } return; }
  const inMenu = e.target.closest('.menu');
  if (t.disabled || (inMenu && !inMenu.contains(t))) return;
  const { action } = t.dataset;
  switch (action) {
    case 'folder': return go({ folderId: t.dataset.folder || null, fileId: null, page: null });
    case 'open': return t.dataset.file && openFile(t.dataset.file);
    case 'menu': state.menu = state.menu === t.dataset.menu ? null : t.dataset.menu; return render();
    case 'todo':
      state.menu = null; render();
      return toast({ title: `${t.dataset.what} isn’t in this prototype`, body: 'Decided in “Document lifecycle UX”.', tone: 'info' });
    case 'upload':
      uploads = uploads.filter((u) => u.progress < 100);
      uploadFolderId = state.folderId; state.menu = null; state.dialog = 'upload'; return render();
    case 'new-folder':
      draft = { name: '', desc: '', keyword: '', keywords: [] }; state.menu = null; state.dialog = 'folder'; render();
      return document.getElementById('folder-name')?.focus();
    case 'dialog-close': state.dialog = null; return render();
    case 'browse': return document.getElementById('file-input')?.click();
    case 'sample-upload': return startUpload(`Scan ${String(++seq).padStart(4, '0')}.pdf`, 300_000 + Math.round(Math.random() * 2_000_000));
    case 'upload-cancel': uploads = uploads.filter((u) => u.id !== Number(t.dataset.id)); return renderOverlays();
    case 'add-keyword': return addKeyword();
    case 'remove-keyword': draft.keywords.splice(Number(t.dataset.index), 1); return renderOverlays();
    case 'create-folder': {
      const f = { id: `folder-${++seq}`, name: draft.name.trim(), parentId: state.folderId, desc: draft.desc, keywords: draft.keywords };
      folders.push(f);
      state.dialog = null; render();
      return toast({ title: 'Folder created', body: f.name });
    }
    case 'toggle-panel': state.panel = !state.panel; return render();
    case 'sheet-open': state.sheet = 'half'; return positionInsights();
    case 'sheet-cycle': state.sheet = state.sheet === 'full' ? 'half' : 'full'; return positionInsights();
    case 'sheet-close': state.sheet = 'closed'; return positionInsights();
    case 'nav-step': {
      const keys = Object.keys(NAVS);
      return go({ nav: keys[(keys.indexOf(state.nav) + Number(t.dataset.dir) + keys.length) % keys.length] }, { replace: true });
    }
    case 'guest-force': state.guestForce = t.dataset.state; renderProtoBar(); return sendSession();
  }
});

function addKeyword() {
  const k = draft.keyword.trim();
  if (k && !draft.keywords.includes(k)) draft.keywords.push(k);
  draft.keyword = '';
  renderOverlays();
  document.getElementById('folder-keyword')?.focus();
}

document.addEventListener('input', (e) => {
  const key = e.target.dataset?.draft;
  if (!key) return;
  draft[key] = e.target.value;
  if (key === 'name') document.getElementById('create-folder').disabled = !draft.name.trim();
});

document.addEventListener('change', (e) => {
  if (e.target.id === 'upload-folder') uploadFolderId = e.target.value || null;
  if (e.target.id === 'file-input') [...e.target.files].forEach((f) => f.type === 'application/pdf' && startUpload(f.name, f.size));
});

document.addEventListener('dragover', (e) => {
  const zone = e.target.closest?.('#drop-zone');
  if (!zone) return;
  e.preventDefault();
  zone.classList.add('is-over');
});
document.addEventListener('dragleave', (e) => e.target.closest?.('#drop-zone')?.classList.remove('is-over'));
document.addEventListener('drop', (e) => {
  const zone = e.target.closest?.('#drop-zone');
  if (!zone) return;
  e.preventDefault();
  [...e.dataTransfer.files].forEach((f) => f.type === 'application/pdf' && startUpload(f.name, f.size));
});

document.addEventListener('keydown', (e) => {
  const typing = e.target.closest?.('input, textarea, select, [contenteditable]');
  if (e.key === 'Escape') {
    if (state.dialog) { state.dialog = null; return render(); }
    if (state.menu) { state.menu = null; return render(); }
  }
  if (e.key === 'Enter' && e.target.id === 'folder-keyword') { e.preventDefault(); return addKeyword(); }
  if (e.key === 'Enter' && e.target.matches?.('[role="button"][data-action]')) return e.target.click();
  if (typing || state.dialog) return;
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    const keys = Object.keys(NAVS);
    const dir = e.key === 'ArrowLeft' ? -1 : 1;
    go({ nav: keys[(keys.indexOf(state.nav) + dir + keys.length) % keys.length] }, { replace: true });
  }
});

window.addEventListener('popstate', () => { readUrl(); state.menu = null; render(); });
window.addEventListener('resize', positionInsights);
mq.addEventListener('change', render);

readUrl();
writeUrl(true);
render();
