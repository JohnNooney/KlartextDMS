<script setup>
const props = defineProps({ status: String });
const labels = {
  idle: 'Idle',
  loading: 'Extracting…',
  success: 'Done',
  error: 'Error',
};
const styles = {
  idle: 'bg-kt-surface border border-kt-border text-kt-text-muted',
  loading: 'bg-kt-accent-dim text-kt-accent animate-pulse',
  success: 'bg-kt-success text-white',
  error: 'bg-kt-danger text-white',
};
</script>

<template>
  <span class="px-2 py-1 rounded-kt-md text-xs font-medium" :class="styles[status]">
    {{ labels[status] ?? status }}
  </span>
</template>
