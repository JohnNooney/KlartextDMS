<script setup>
const props = defineProps({ status: String });
const labels = {
  idle: 'Idle',
  loading: 'Extracting…',
  success: 'Done',
  error: 'Error',
};
const styles = {
  idle: 'bg-kt-surface-raised text-kt-text-muted',
  loading: 'bg-kt-accent-dim text-kt-text animate-pulse',
  success: 'bg-kt-success text-kt-bg',
  error: 'bg-kt-danger text-kt-bg',
};
</script>

<template>
  <span class="px-2 py-1 rounded-kt-md text-xs font-medium" :class="styles[status]">
    {{ labels[status] ?? status }}
  </span>
</template>
