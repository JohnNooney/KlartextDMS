<script setup lang="ts">
import { computed } from 'vue';
import ExtractionPanel from './ExtractionPanel.vue';
import { currentSession, requestRetry } from './session-store';

// Guest shell (issue #26): the insights panel driven by the Session the Host
// sends over the Bus. The (job state × Extraction) matrix is issue #15's —
// a stored Extraction always renders under the current indicator; without
// one, each job state gets its own block. "Analyze document"/"Try again"
// both send RETRY_EXTRACTION — the Guest's only write-back (issue #31).
const extraction = computed(() => currentSession.value?.extraction ?? null);
const extractionState = computed(() => currentSession.value?.extractionState ?? 'none');

function reanalyze(): void {
  const documentId = currentSession.value?.documentId;
  if (documentId) requestRetry(documentId);
}
</script>

<template>
  <main class="min-h-screen bg-kt-canvas font-sans">
    <ExtractionPanel
      v-if="currentSession && extraction"
      :extraction="extraction"
      :document-title="currentSession.documentTitle"
      :extraction-state="extractionState"
      @reanalyze="reanalyze"
    />
    <div v-else class="flex h-screen items-center justify-center">
      <div class="rounded-kt-lg bg-kt-surface p-kt-8 text-center shadow-kt-panel">
        <p class="text-kt-lg font-semibold text-kt-text">Klartext</p>
        <p v-if="!currentSession" class="mt-kt-2 text-kt-sm text-kt-text-muted">
          Open a document in the Host to see its Extraction here.
        </p>
        <template v-else-if="extractionState === 'failed'">
          <p class="mt-kt-2 text-kt-sm text-kt-danger">Extraction failed.</p>
          <button
            type="button"
            class="mt-kt-4 rounded-kt-md bg-kt-accent px-kt-4 py-kt-2 text-kt-sm font-medium text-kt-canvas hover:bg-kt-accent-hover"
            @click="reanalyze"
          >
            Try again
          </button>
        </template>
        <p v-else-if="extractionState === 'queued'" class="mt-kt-2 text-kt-sm text-kt-text-muted">
          Waiting to analyze…
        </p>
        <p v-else-if="extractionState === 'running'" class="mt-kt-2 text-kt-sm text-kt-text-muted">
          Analyzing…
        </p>
        <template v-else>
          <p class="mt-kt-2 text-kt-sm text-kt-text-muted">
            No Extraction yet for this Document.
          </p>
          <button
            type="button"
            class="mt-kt-4 rounded-kt-md bg-kt-accent px-kt-4 py-kt-2 text-kt-sm font-medium text-kt-canvas hover:bg-kt-accent-hover"
            @click="reanalyze"
          >
            Analyze document
          </button>
        </template>
      </div>
    </div>
  </main>
</template>
