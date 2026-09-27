<script setup lang="ts">
import { computed } from 'vue';
import ExtractionPanel from './ExtractionPanel.vue';
import { currentSession } from './session-store';

// Guest shell (issue #26): the insights panel driven by the Session the Host
// sends over the Bus. Before the first INIT_SESSION — or in standalone dev
// until the fixture loads — the panel shows its empty state.
const extraction = computed(() => currentSession.value?.extraction ?? null);
const extractionState = computed(() => currentSession.value?.extractionState ?? 'none');
</script>

<template>
  <main class="min-h-screen bg-kt-canvas font-sans">
    <ExtractionPanel
      v-if="currentSession && extraction"
      :extraction="extraction"
      :document-title="currentSession.documentTitle"
    />
    <div v-else class="flex h-screen items-center justify-center">
      <div class="rounded-kt-lg bg-kt-surface p-kt-8 text-center shadow-kt-panel">
        <p class="text-kt-lg font-semibold text-kt-text">Klartext</p>
        <p v-if="!currentSession" class="mt-kt-2 text-kt-sm text-kt-text-muted">
          Open a document in the Host to see its Extraction here.
        </p>
        <p v-else-if="extractionState === 'failed'" class="mt-kt-2 text-kt-sm text-kt-text-muted">
          Extraction failed.
        </p>
        <p
          v-else-if="extractionState === 'queued' || extractionState === 'running'"
          class="mt-kt-2 text-kt-sm text-kt-text-muted"
        >
          Extraction in progress — this can take a minute.
        </p>
        <p v-else class="mt-kt-2 text-kt-sm text-kt-text-muted">
          No Extraction yet for this Document.
        </p>
      </div>
    </div>
  </main>
</template>
