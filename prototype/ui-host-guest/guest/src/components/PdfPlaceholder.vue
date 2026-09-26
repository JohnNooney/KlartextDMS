<script setup>
defineProps({ docId: String, docType: String });
</script>

<template>
  <div class="bg-kt-bg flex flex-col items-center justify-center text-kt-text-muted p-6">
    <div class="border-2 border-dashed border-kt-border rounded-kt-lg p-8 text-center max-w-sm">
      <div class="text-4xl mb-3">📄</div>
      <h3 class="text-kt-text font-medium mb-1">{{ docType }}</h3>
      <p class="text-sm mb-4">PDF viewer placeholder</p>
      <p class="text-xs font-mono bg-kt-surface rounded-kt-md px-2 py-1 inline-block">{{ docId }}</p>
      <p class="text-xs mt-4">In production the native PDF viewer or pdf.js would render here.</p>
    </div>
  </div>
</template>
