import '../shared/theme.css';
import './styles.scss';

const defaultFolders = [
  { id: 'all', name: 'All files', icon: '📁' },
  { id: 'mietvertrag', name: 'Mietvertrag', icon: '🏠' },
  { id: 'krankenversicherung', name: 'Krankenversicherung', icon: '🏥' },
  { id: 'internetvertrag', name: 'Internetvertrag', icon: '🌐' },
];

let folders = [...defaultFolders];
let files = [
  { id: 'f-1', name: 'Mietvertrag 2024.pdf', type: 'pdf', folderId: 'mietvertrag', status: 'ready', size: 1_240_000, date: '15 Mar 2024' },
  { id: 'f-2', name: 'Krankenversicherung Q3.pdf', type: 'pdf', folderId: 'krankenversicherung', status: 'ready', size: 890_000, date: '02 Jun 2024' },
  { id: 'f-3', name: 'Internetvertrag.pdf', type: 'pdf', folderId: 'internetvertrag', status: 'ready', size: 560_000, date: '3 Hours ago' },
];

let activeFolderId = 'all';
let selectedFileId = null;
let mobileInsightsOpen = false;
let fileCounter = 4;
let folderCounter = 5;

const els = {
  fileTree: document.getElementById('file-tree'),
  stageTitle: document.getElementById('stage-title'),
  stageMeta: document.getElementById('stage-meta'),
  fileExplorer: document.getElementById('file-explorer'),
  reader: document.getElementById('reader'),
  readerTitle: document.getElementById('reader-title'),
  pdfPane: document.getElementById('pdf-pane'),
  guestFrame: document.getElementById('guest-frame'),
  guestFrameMobile: document.getElementById('guest-frame-mobile'),
  sheet: document.getElementById('sheet'),
  sheetOverlay: document.getElementById('sheet-overlay'),
  uploadDialog: document.getElementById('upload-dialog'),
  uploadList: document.getElementById('upload-list'),
  fileInput: document.getElementById('file-input'),
  browseBtn: document.getElementById('browse-btn'),
  dropZone: document.getElementById('drop-zone'),
  folderDialog: document.getElementById('folder-dialog'),
  folderName: document.getElementById('folder-name'),
  folderDesc: document.getElementById('folder-desc'),
  folderKeyword: document.getElementById('folder-keyword'),
  addKeyword: document.getElementById('add-keyword'),
  keywordTags: document.getElementById('keyword-tags'),
  typeOptions: document.getElementById('type-options'),
  toasts: document.getElementById('toasts'),
};

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function totalSize(list) {
  return list.reduce((sum, f) => sum + f.size, 0);
}

function fileIcon(type) {
  const colors = { pdf: '#dc2626', doc: '#2563eb', xls: '#16a34a', ppt: '#ea580c', img: '#9333ea' };
  const color = colors[type] ?? '#64748b';
  return `<svg class="file-thumb" viewBox="0 0 48 60" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 4a4 4 0 0 1 4-4h24l16 16v36a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V4z" fill="#f1f5f9" stroke="${color}" stroke-width="2"/><path d="M32 0v16h16" fill="${color}"/><text x="24" y="44" text-anchor="middle" fill="${color}" font-size="11" font-weight="700">${type.toUpperCase()}</text></svg>`;
}

function folderIcon() {
  return `<svg class="folder-thumb" viewBox="0 0 60 48" fill="none"><path d="M4 12a4 4 0 0 1 4-4h12l6 8h26a4 4 0 0 1 4 4v24a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V12z" fill="#93c5fd" stroke="#2563eb" stroke-width="2"/></svg>`;
}

function renderTree() {
  els.fileTree.innerHTML = '';
  folders.forEach((folder) => {
    const btn = document.createElement('button');
    btn.className = 'tree-item' + (folder.id === activeFolderId ? ' active' : '');
    btn.innerHTML = `<span class="tree-icon">${folder.icon ?? '📁'}</span><span class="tree-label">${folder.name}</span>`;
    btn.addEventListener('click', () => { activeFolderId = folder.id; renderTree(); renderExplorer(); });
    els.fileTree.appendChild(btn);
  });
}

function visibleFiles() {
  if (activeFolderId === 'all') return files;
  return files.filter((f) => f.folderId === activeFolderId);
}

function renderExplorer() {
  const folder = folders.find((f) => f.id === activeFolderId);
  const list = visibleFiles();
  els.stageTitle.textContent = folder.name;
  els.stageMeta.textContent = `${list.length} ${list.length === 1 ? 'file' : 'files'} • ${formatSize(totalSize(list))}`;
  els.fileExplorer.innerHTML = '';

  const uploadCard = document.createElement('button');
  uploadCard.className = 'file-card upload-card';
  uploadCard.innerHTML = `<span class="upload-plus">+</span><span class="file-name">Upload file</span>`;
  uploadCard.addEventListener('click', openUpload);
  els.fileExplorer.appendChild(uploadCard);

  list.forEach((file) => {
    const card = document.createElement('button');
    card.className = 'file-card' + (file.id === selectedFileId ? ' active' : '');
    const meta = file.status === 'processing' ? 'Processing…' : file.date;
    card.innerHTML = `${fileIcon(file.type)}<span class="file-name">${file.name}</span><span class="file-size">${formatSize(file.size)} • ${meta}</span>`;
    card.addEventListener('click', () => openFile(file.id));
    els.fileExplorer.appendChild(card);
  });
}

function openFile(id) {
  selectedFileId = id;
  const file = files.find((f) => f.id === id);
  els.fileExplorer.classList.add('hidden');
  els.reader.classList.remove('hidden');
  els.readerTitle.textContent = file.name;

  els.pdfPane.innerHTML = `
    <div class="pdf-placeholder">
      ${fileIcon(file.type)}
      <strong>${file.name}</strong>
      <code>${formatSize(file.size)}</code>
      <p>Raw PDF rendered here in production.</p>
    </div>
  `;

  const status = file.status === 'ready' ? 'success' : 'loading';
  const src = `http://localhost:5174/?doc=${encodeURIComponent(file.id)}&type=${encodeURIComponent(file.type)}&status=${status}`;
  els.guestFrame.src = src;
  els.guestFrameMobile.src = src;

  window.addEventListener('message', onGuestMessage);
}

function onGuestMessage(event) {
  const msg = event.data;
  if (!msg || msg.v !== 1) return;
  if (msg.type === 'GUEST_READY') sendGuestState();
}

function sendGuestState() {
  const file = files.find((f) => f.id === selectedFileId);
  if (!file) return;
  const status = file.status === 'ready' ? 'success' : 'loading';
  const envelope = { v: 1, type: 'INIT_SESSION', sessionId: 'proto', payload: { fileId: file.id, status, type: file.type } };
  els.guestFrame.contentWindow?.postMessage(envelope, '*');
  els.guestFrameMobile.contentWindow?.postMessage(envelope, '*');
}

function backToFiles() {
  selectedFileId = null;
  els.reader.classList.add('hidden');
  els.fileExplorer.classList.remove('hidden');
  window.removeEventListener('message', onGuestMessage);
  closeSheet();
  renderExplorer();
}

function openSheet() {
  mobileInsightsOpen = true;
  els.sheet.classList.remove('hidden');
  els.sheetOverlay.classList.remove('hidden');
  document.body.classList.add('sheet-open');
}

function closeSheet() {
  mobileInsightsOpen = false;
  els.sheet.classList.add('hidden');
  els.sheetOverlay.classList.add('hidden');
  document.body.classList.remove('sheet-open');
}

// Upload dialog state
let pendingUploads = [];

function openUpload() {
  pendingUploads = [];
  renderUploadList();
  els.fileInput.value = '';
  els.uploadDialog.showModal();
}

function addPendingFiles(fileList) {
  for (const file of fileList) {
    if (file.type !== 'application/pdf') continue;
    pendingUploads.push({ name: file.name, size: file.size, progress: 0 });
  }
  renderUploadList();
}

function renderUploadList() {
  if (pendingUploads.length === 0) {
    els.uploadList.innerHTML = '';
    return;
  }
  els.uploadList.innerHTML = pendingUploads.map((f, i) => `
    <div class="upload-row">
      ${fileIcon('pdf')}
      <div class="upload-info">
        <div class="upload-name">${f.name}</div>
        <div class="upload-meta">${formatSize(f.size)}</div>
        <div class="progress-bar"><div class="progress-fill" style="width:${f.progress}%"></div></div>
      </div>
      <button class="upload-remove" data-index="${i}" aria-label="Remove">×</button>
    </div>
  `).join('');

  els.uploadList.querySelectorAll('.upload-remove').forEach((btn) => {
    btn.addEventListener('click', () => {
      pendingUploads.splice(Number(btn.dataset.index), 1);
      renderUploadList();
    });
  });
}

function simulateUploadProgress(onDone) {
  let step = 0;
  const interval = setInterval(() => {
    step += 1;
    pendingUploads.forEach((f) => { f.progress = Math.min(step * 20, 100); });
    renderUploadList();
    if (step >= 5) {
      clearInterval(interval);
      onDone();
    }
  }, 250);
}

function confirmUpload() {
  simulateUploadProgress(() => {
    const folderId = activeFolderId === 'all' ? 'mietvertrag' : activeFolderId;
    pendingUploads.forEach((upload) => {
      const id = `f-${fileCounter++}`;
      const file = { id, name: upload.name, type: 'pdf', folderId, status: 'processing', size: upload.size, date: 'Just now' };
      files.push(file);
      setTimeout(() => {
        file.status = 'ready';
        if (selectedFileId === id) openFile(id);
        else renderExplorer();
        showToast(`Processing complete: ${file.name}`);
      }, 5000);
    });
    els.uploadDialog.close('cancel');
    renderExplorer();
  });
}

// New folder dialog state
let folderKeywords = [];
let selectedTypes = new Set(['pdf']);

function openNewFolder() {
  folderKeywords = [];
  selectedTypes = new Set(['pdf']);
  els.folderName.value = '';
  els.folderDesc.value = '';
  els.folderKeyword.value = '';
  renderKeywordTags();
  renderTypeOptions();
  els.folderDialog.showModal();
}

function renderKeywordTags() {
  els.keywordTags.innerHTML = folderKeywords.map((kw) => `<span class="keyword-tag">${kw}<button data-kw="${kw}">×</button></span>`).join('');
  els.keywordTags.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      folderKeywords = folderKeywords.filter((k) => k !== btn.dataset.kw);
      renderKeywordTags();
    });
  });
}

function renderTypeOptions() {
  els.typeOptions.querySelectorAll('.type-option').forEach((btn) => {
    btn.classList.toggle('active', selectedTypes.has(btn.dataset.type));
  });
}

function confirmFolder() {
  const name = els.folderName.value.trim();
  if (!name) return;
  const id = `folder-${folderCounter++}`;
  folders.push({ id, name, icon: '📁', desc: els.folderDesc.value.trim(), keywords: [...folderKeywords], types: [...selectedTypes] });
  activeFolderId = id;
  renderTree();
  renderExplorer();
  els.folderDialog.close('cancel');
  showToast(`Folder created: ${name}`);
}

function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  els.toasts.appendChild(toast);
  setTimeout(() => toast.classList.add('show'), 10);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// Event bindings
els.browseBtn.addEventListener('click', () => els.fileInput.click());
els.fileInput.addEventListener('change', () => addPendingFiles(els.fileInput.files));

els.dropZone.addEventListener('dragover', (e) => { e.preventDefault(); els.dropZone.classList.add('drag-over'); });
els.dropZone.addEventListener('dragleave', () => els.dropZone.classList.remove('drag-over'));
els.dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  els.dropZone.classList.remove('drag-over');
  addPendingFiles(e.dataTransfer.files);
});

els.uploadDialog.addEventListener('close', () => {
  if (els.uploadDialog.returnValue === 'confirm') confirmUpload();
});

els.folderDialog.addEventListener('close', () => {
  if (els.folderDialog.returnValue === 'confirm') confirmFolder();
});

els.addKeyword.addEventListener('click', () => {
  const kw = els.folderKeyword.value.trim();
  if (!kw || folderKeywords.includes(kw)) return;
  folderKeywords.push(kw);
  els.folderKeyword.value = '';
  renderKeywordTags();
});

els.typeOptions.addEventListener('click', (e) => {
  const btn = e.target.closest('.type-option');
  if (!btn) return;
  const type = btn.dataset.type;
  if (selectedTypes.has(type)) selectedTypes.delete(type);
  else selectedTypes.add(type);
  renderTypeOptions();
});

document.getElementById('back-btn').addEventListener('click', backToFiles);
document.getElementById('insights-toggle').addEventListener('click', openSheet);
els.sheetOverlay.addEventListener('click', closeSheet);
els.sheet.querySelector('.sheet-handle').addEventListener('click', closeSheet);
document.getElementById('upload-btn').addEventListener('click', openUpload);
document.getElementById('new-folder-btn').addEventListener('click', openNewFolder);
document.getElementById('new-folder-header').addEventListener('click', openNewFolder);

renderTree();
renderExplorer();
