const documents = [
  { id: 'doc-1', type: 'Mietvertrag', name: 'Mietvertrag.pdf', icon: '🏠' },
  { id: 'doc-2', type: 'Krankenversicherung', name: 'Krankenversicherung.pdf', icon: '🏥' },
  { id: 'doc-3', type: 'Internetvertrag', name: 'Internetvertrag.pdf', icon: '🌐' },
];

let selectedId = null;
let extracting = false;

const sidebar = document.getElementById('sidebar');
const list = document.getElementById('document-list');
const frame = document.getElementById('guest-frame');
const welcome = document.getElementById('welcome');
const runBtn = document.getElementById('simulate-run');

function renderList() {
  list.innerHTML = '';
  documents.forEach((doc) => {
    const btn = document.createElement('button');
    btn.className = 'doc-item' + (doc.id === selectedId ? ' active' : '');
    btn.innerHTML = `<span class="doc-icon">${doc.icon}</span><div class="doc-meta"><strong>${doc.type}</strong><span>${doc.name}</span></div>`;
    btn.addEventListener('click', () => selectDocument(doc.id));
    list.appendChild(btn);
  });
}

function selectDocument(id) {
  selectedId = id;
  renderList();
  welcome.classList.add('hidden');
  frame.classList.remove('hidden');
  const doc = documents.find((d) => d.id === id);
  frame.src = `http://localhost:5174/?doc=${encodeURIComponent(doc.id)}&type=${encodeURIComponent(doc.type)}`;
}

function setExtracting(value) {
  extracting = value;
  if (value) {
    sidebar.classList.add('locked');
    runBtn.textContent = 'Stop extraction';
  } else {
    sidebar.classList.remove('locked');
    runBtn.textContent = 'Simulate extraction run';
  }
}

runBtn.addEventListener('click', () => {
  if (!selectedId) {
    alert('Select a Document first.');
    return;
  }
  setExtracting(!extracting);
  if (extracting) {
    frame.contentWindow.postMessage({ v: 1, type: 'AI_PROCESSING_STARTED', sessionId: 'proto' }, '*');
    setTimeout(() => {
      frame.contentWindow.postMessage({ v: 1, type: 'AI_PROCESSING_SUCCESS', sessionId: 'proto' }, '*');
      setExtracting(false);
    }, 4000);
  }
});

window.addEventListener('message', (event) => {
  const msg = event.data;
  if (msg?.type === 'GUEST_READY') {
    console.log('Host received GUEST_READY', msg);
  }
});

renderList();
