const folders = [
  { id: 'all', name: 'All files', icon: '📁' },
  { id: 'mietvertrag', name: 'Mietvertrag', icon: '🏠' },
  { id: 'krankenversicherung', name: 'Krankenversicherung', icon: '🏥' },
  { id: 'internetvertrag', name: 'Internetvertrag', icon: '🌐' },
];

let files = [
  { id: 'f-1', name: 'Mietvertrag 2024.pdf', type: 'Mietvertrag', folderId: 'mietvertrag', status: 'ready' },
  { id: 'f-2', name: 'Krankenversicherung Q3.pdf', type: 'Krankenversicherung', folderId: 'krankenversicherung', status: 'ready' },
  { id: 'f-3', name: 'Internetvertrag.pdf', type: 'Internetvertrag', folderId: 'internetvertrag', status: 'ready' },
];

let activeFolderId = 'all';
let selectedFileId = null;
let mobileInsightsOpen = false;
let fileCounter = 4;

const fileTree = document.getElementById('file-tree');
const stageTitle = document.getElementById('stage-title');
const fileExplorer = document.getElementById('file-explorer');
const reader = document.getElementById('reader');
const readerTitle = document.getElementById('reader-title');
const pdfPane = document.getElementById('pdf-pane');
const guestFrame = document.getElementById('guest-frame');
const guestFrameMobile = document.getElementById('guest-frame-mobile');
const sheet = document.getElementById('sheet');
const sheetOverlay = document.getElementById('sheet-overlay');
const uploadDialog = document.getElementById('upload-dialog');
const uploadFolder = document.getElementById('upload-folder');
const toasts = document.getElementById('toasts');

function renderTree() {
  fileTree.innerHTML = '';
  folders.forEach((folder) => {
    const btn = document.createElement('button');
    btn.className = 'tree-item' + (folder.id === activeFolderId ? ' active' : '');
    btn.innerHTML = `<span class="tree-icon">${folder.icon}</span><span class="tree-label">${folder.name}</span>`;
    btn.addEventListener('click', () => { activeFolderId = folder.id; renderTree(); renderExplorer(); });
    fileTree.appendChild(btn);
  });
}

function visibleFiles() {
  if (activeFolderId === 'all') return files;
  return files.filter((f) => f.folderId === activeFolderId);
}

function renderExplorer() {
  const folder = folders.find((f) => f.id === activeFolderId);
  stageTitle.textContent = folder.name;
  fileExplorer.innerHTML = '';

  const uploadCard = document.createElement('button');
  uploadCard.className = 'file-card upload-card';
  uploadCard.innerHTML = `<span class="file-icon">+</span><span class="file-name">Upload file</span>`;
  uploadCard.addEventListener('click', openUpload);
  fileExplorer.appendChild(uploadCard);

  visibleFiles().forEach((file) => {
    const card = document.createElement('button');
    card.className = 'file-card' + (file.id === selectedFileId ? ' active' : '');
    const icon = file.status === 'processing' ? '⏳' : '📄';
    const meta = file.status === 'processing' ? 'Processing…' : 'Ready';
    card.innerHTML = `<span class="file-icon">${icon}</span><div class="file-meta"><span class="file-name">${file.name}</span><span class="file-status">${meta}</span></div>`;
    card.addEventListener('click', () => openFile(file.id));
    fileExplorer.appendChild(card);
  });
}

function openFile(id) {
  selectedFileId = id;
  const file = files.find((f) => f.id === id);
  fileExplorer.classList.add('hidden');
  reader.classList.remove('hidden');
  readerTitle.textContent = file.name;

  pdfPane.innerHTML = `
    <div class="pdf-placeholder">
      <span class="pdf-icon">📑</span>
      <strong>${file.type}</strong>
      <code>${file.name}</code>
      <p>Raw PDF rendered here in production.</p>
    </div>
  `;

  const src = `http://localhost:5174/?doc=${encodeURIComponent(file.id)}&type=${encodeURIComponent(file.type)}&status=${encodeURIComponent(file.status)}`;
  guestFrame.src = src;
  guestFrameMobile.src = src;

  window.addEventListener('message', onGuestMessage);
}

function onGuestMessage(event) {
  const msg = event.data;
  if (!msg || msg.v !== 1) return;
  if (msg.type === 'GUEST_READY') {
    sendGuestState();
  }
}

function sendGuestState() {
  const file = files.find((f) => f.id === selectedFileId);
  if (!file) return;
  const payload = { fileId: file.id, status: file.status };
  const envelope = { v: 1, type: 'INIT_SESSION', sessionId: 'proto', payload };
  guestFrame.contentWindow?.postMessage(envelope, '*');
  guestFrameMobile.contentWindow?.postMessage(envelope, '*');
}

function backToFiles() {
  selectedFileId = null;
  reader.classList.add('hidden');
  fileExplorer.classList.remove('hidden');
  window.removeEventListener('message', onGuestMessage);
  closeSheet();
  renderExplorer();
}

function openSheet() {
  mobileInsightsOpen = true;
  sheet.classList.remove('hidden');
  sheetOverlay.classList.remove('hidden');
  document.body.classList.add('sheet-open');
}

function closeSheet() {
  mobileInsightsOpen = false;
  sheet.classList.add('hidden');
  sheetOverlay.classList.add('hidden');
  document.body.classList.remove('sheet-open');
}

function openUpload() {
  uploadFolder.innerHTML = folders
    .filter((f) => f.id !== 'all')
    .map((f) => `<option value="${f.id}">${f.name}</option>`)
    .join('');
  uploadDialog.showModal();
}

function addFile(name, folderId) {
  const id = `f-${fileCounter++}`;
  const folder = folders.find((f) => f.id === folderId);
  const file = { id, name, type: folder.name, folderId, status: 'processing' };
  files.push(file);
  renderExplorer();

  // Simulate processing completion after 5 s.
  setTimeout(() => {
    file.status = 'ready';
    if (selectedFileId === id) {
      openFile(id); // refresh Guest
    } else {
      renderExplorer();
    }
    showToast(`Processing complete: ${file.name}`);
  }, 5000);
}

function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  toasts.appendChild(toast);
  setTimeout(() => toast.classList.add('show'), 10);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

document.getElementById('back-btn').addEventListener('click', backToFiles);
document.getElementById('insights-toggle').addEventListener('click', openSheet);
sheetOverlay.addEventListener('click', closeSheet);
document.querySelector('.sheet-handle').addEventListener('click', closeSheet);
document.getElementById('upload-btn').addEventListener('click', openUpload);

uploadDialog.addEventListener('close', () => {
  if (uploadDialog.returnValue !== 'confirm') return;
  let name = document.getElementById('upload-name').value.trim();
  const folderId = uploadFolder.value;
  if (!name) name = 'Untitled.pdf';
  if (!name.toLowerCase().endsWith('.pdf')) name += '.pdf';
  addFile(name, folderId);
  document.getElementById('upload-name').value = '';
});

renderTree();
renderExplorer();
