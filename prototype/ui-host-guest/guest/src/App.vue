<script setup>
import { ref, computed, onMounted } from 'vue';
import ExtractionPanel from './components/ExtractionPanel.vue';
import StateBadge from './components/StateBadge.vue';

const params = new URLSearchParams(window.location.search);
const docId = ref(params.get('doc') ?? 'none');
const docType = ref(params.get('type') ?? 'Document');

// Status comes from the Host via INIT_SESSION; default to query param if present.
const initialStatus = params.get('status') === 'ready' ? 'success' : params.get('status') === 'processing' ? 'loading' : 'idle';
const status = ref(initialStatus);

const extraction = ref({
  documentType: docType.value,
  translatedSummary:
    'Der Mietvertrag ist unbefristet und kann von beiden Parteien nur unter bestimmten Bedingungen gekündigt werden.',
  keyTakeaways: [
    'Kündigungsfrist beträgt drei Monate.',
    'Miete ist zum dritten Werktag fällig.',
    'Nebenkosten werden jährlich mit dem Vermieter abgerechnet.',
  ],
  criticalWarnings: [
    'Eine automatische Mietpreisbremse wird im Vertrag nicht erwähnt.',
    'Kaution kann in drei Monatsmieten verlangt werden.',
  ],
});

const errorMessage = ref('The extraction could not be completed. Please try again later.');

function setState(next) {
  status.value = next;
}

onMounted(() => {
  window.parent.postMessage({ v: 1, type: 'GUEST_READY', sessionId: 'proto' }, '*');
  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg || msg.v !== 1) return;
    if (msg.type === 'INIT_SESSION') {
      const incoming = msg.payload?.status;
      if (incoming === 'processing') setState('loading');
      else if (incoming === 'ready') setState('success');
      else setState('idle');
      if (msg.payload?.type) docType.value = msg.payload.type;
    } else if (msg.type === 'AI_PROCESSING_STARTED') {
      setState('loading');
    } else if (msg.type === 'AI_PROCESSING_SUCCESS') {
      setState('success');
    } else if (msg.type === 'AI_PROCESSING_ERROR') {
      setState('error');
    }
  });
});
</script>

<template>
  <div class="h-full flex flex-col bg-kt-bg text-kt-text">
    <header class="h-12 border-b border-kt-border bg-kt-surface flex items-center justify-between px-4 shrink-0">
      <span class="text-sm font-medium text-kt-text-muted">Insights</span>
      <StateBadge :status="status" />
    </header>

    <main class="flex-1 min-h-0 overflow-hidden">
      <ExtractionPanel
        :status="status"
        :extraction="extraction"
        :error-message="errorMessage"
        class="h-full"
        @set-state="setState"
      />
    </main>
  </div>
</template>
