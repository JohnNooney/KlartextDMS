<script setup>
const props = defineProps({
  status: { type: String, required: true },
  extraction: { type: Object, required: true },
  errorMessage: { type: String, default: '' },
});
const emit = defineEmits(['set-state']);
</script>

<template>
  <section class="bg-kt-bg flex flex-col h-full">
    <div class="px-4 h-12 flex items-center border-b border-kt-border">
      <h2 class="text-sm font-semibold uppercase tracking-wide text-kt-text-muted">Extraction</h2>
    </div>

    <div class="flex-1 overflow-y-auto p-4 space-y-4">
      <div v-if="status === 'idle'" class="text-kt-text-muted text-sm">
        Select a document in the Host to begin extraction.
      </div>

      <div v-else-if="status === 'loading'" class="space-y-4 animate-pulse">
        <div class="h-4 bg-kt-surface rounded-kt-md w-3/4"></div>
        <div class="h-24 bg-kt-surface rounded-kt-md border border-kt-border"></div>
        <div class="space-y-2">
          <div class="h-3 bg-kt-surface rounded-kt-md w-5/6"></div>
          <div class="h-3 bg-kt-surface rounded-kt-md w-4/6"></div>
          <div class="h-3 bg-kt-surface rounded-kt-md w-3/4"></div>
        </div>
      </div>

      <div v-else-if="status === 'success'" class="space-y-5">
        <div class="space-y-2">
          <h3 class="text-xs font-semibold uppercase text-kt-accent">Translated summary</h3>
          <p class="text-kt-text leading-relaxed">{{ extraction.translatedSummary }}</p>
        </div>

        <div class="space-y-2">
          <h3 class="text-xs font-semibold uppercase text-kt-success">Key takeaways</h3>
          <ul class="list-disc list-inside space-y-1 text-sm text-kt-text">
            <li v-for="item in extraction.keyTakeaways" :key="item">{{ item }}</li>
          </ul>
        </div>

        <div class="space-y-2 border border-kt-warning rounded-kt-md p-3 bg-kt-surface">
          <h3 class="text-xs font-semibold uppercase text-kt-danger">Critical warnings</h3>
          <ul class="list-disc list-inside space-y-1 text-sm text-kt-warning">
            <li v-for="item in extraction.criticalWarnings" :key="item">{{ item }}</li>
          </ul>
        </div>
      </div>

      <div v-else-if="status === 'error'" class="border border-kt-danger rounded-kt-md p-4 bg-kt-surface text-kt-danger">
        <p class="font-medium">Extraction failed</p>
        <p class="text-sm mt-1">{{ errorMessage }}</p>
      </div>
    </div>

    <div class="border-t border-kt-border p-4 flex gap-2 bg-kt-surface">
      <button
        class="flex-1 px-3 py-2 rounded-kt-md border border-kt-border text-sm hover:bg-kt-surface-hover disabled:opacity-40"
        :disabled="status === 'loading'"
        @click="emit('set-state', 'idle')"
      >
        Reset
      </button>
      <button
        class="flex-1 px-3 py-2 rounded-kt-md border border-kt-border text-sm hover:bg-kt-surface-hover disabled:opacity-40"
        :disabled="status === 'loading'"
        @click="emit('set-state', 'loading')"
      >
        Loading
      </button>
      <button
        class="flex-1 px-3 py-2 rounded-kt-md bg-kt-success text-white text-sm hover:opacity-90 disabled:opacity-40"
        :disabled="status === 'loading'"
        @click="emit('set-state', 'success')"
      >
        Success
      </button>
      <button
        class="flex-1 px-3 py-2 rounded-kt-md bg-kt-danger text-white text-sm hover:opacity-90 disabled:opacity-40"
        :disabled="status === 'loading'"
        @click="emit('set-state', 'error')"
      >
        Error
      </button>
    </div>
  </section>
</template>
