<script setup>
import { ref, computed, onMounted } from 'vue';
import ExtractionPanel from './components/ExtractionPanel.vue';
import PdfPlaceholder from './components/PdfPlaceholder.vue';
import StateBadge from './components/StateBadge.vue';

const params = new URLSearchParams(window.location.search);
const docId = ref(params.get('doc') ?? 'none');
const docType = ref(params.get('type') ?? 'Document');
const status = ref('idle'); // idle | loading | success | error

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
    if (msg.type === 'AI_PROCESSING_STARTED') {
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
  <div class="h-screen flex flex-col">
    <header class="h-14 border-b border-kt-border bg-kt-surface flex items-center justify-between px-4 shrink-0">
      <div class="flex items-center gap-3">
        <span class="text-sm font-medium text-kt-text-muted">Guest</span>
        <span class="text-kt-accent">{{ docType }}</span>
      </div>
      <StateBadge :status="status" />
    </header>

    <main class="flex-1 flex min-h-0">
      <PdfPlaceholder :doc-id="docId" :doc-type="docType" class="flex-1" />
      <ExtractionPanel
        :status="status"
        :extraction="extraction"
        :error-message="errorMessage"
        class="w-[420px] border-l border-kt-border flex-shrink-0"
        @set-state="setState"
      />
    </main>
  </div>
</template>
