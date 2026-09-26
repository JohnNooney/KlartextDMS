<script setup>
// PROTOTYPE ONLY — Guest as the "smart panel". Renders only what the Host hands it in the Session.
import { ref, computed, onMounted } from 'vue';
import ExtractionPanel from './components/ExtractionPanel.vue';

const HOST_ORIGIN = 'http://localhost:5173';
const sessionId = new URLSearchParams(location.search).get('session');
const session = ref(null);

const SAMPLE = {
  label: 'Tenancy agreement', sourceLanguage: 'German', extractionStatus: 'COMPLETE', model: 'gemini-2.5-flash', createdAt: 'Today',
  plainEnglishSummary: 'Sample Extraction shown because this Document has none stored yet.',
  keyTakeaways: [{ text: 'Sample critical takeaway.', importance: 'CRITICAL', sourceQuote: 'Beispiel', page: 1 }],
};

// View = what the panel shows. Content statuses (COMPLETE / INSUFFICIENT_CONTENT) differ from processing errors.
const view = computed(() => {
  const s = session.value;
  if (!s) return { kind: 'opening' };
  const force = s.force ?? 'auto';
  if (force === 'loading') return { kind: 'loading' };
  if (force === 'error') return { kind: 'error', code: 'TIMEOUT' };
  if (force === 'insufficient') return { kind: 'insufficient', extraction: { ...(s.extraction ?? SAMPLE), extractionStatus: 'INSUFFICIENT_CONTENT', statusExplanation: 'The scan is too blurry to read reliably. Try a sharper scan or the original PDF.' } };
  if (force === 'complete') return { kind: 'complete', extraction: s.extraction?.extractionStatus === 'COMPLETE' ? s.extraction : SAMPLE };
  if (s.status === 'processing' || !s.extraction) return { kind: 'loading' };
  if (s.extraction.extractionStatus !== 'COMPLETE') return { kind: 'insufficient', extraction: s.extraction };
  return { kind: 'complete', extraction: s.extraction };
});

function send(type, payload) {
  window.parent.postMessage({ v: 1, type, sessionId, payload }, HOST_ORIGIN);
}

onMounted(() => {
  window.addEventListener('message', (e) => {
    if (e.origin !== HOST_ORIGIN || e.source !== window.parent) return;
    const msg = e.data;
    if (msg?.v === 1 && msg.type === 'INIT_SESSION' && msg.sessionId === sessionId) session.value = msg.payload;
  });
  send('GUEST_READY');
});
</script>

<template>
  <ExtractionPanel
    :view="view"
    :title="session?.title"
    @show-page="(page) => send('GUEST_SHOW_PAGE', { page })"
    @retry="send('GUEST_RETRY')"
  />
</template>
