<script setup lang="ts">
import type { KeyTakeaway } from '@klartext/bus-contract';

// One Key Takeaway card: the fact, its exact source quote, and the page it
// came from. `critical` gets the warning tint — the "Needs your attention"
// treatment (issue #26).
defineProps<{ takeaway: KeyTakeaway; critical?: boolean }>();
</script>

<template>
  <li
    class="rounded-kt-md border p-kt-4"
    :class="
      critical
        ? 'border-kt-warning bg-kt-warning-tint'
        : 'border-kt-border bg-kt-surface shadow-kt-panel'
    "
  >
    <p class="text-kt-sm" :class="{ 'font-medium': critical }">{{ takeaway.text }}</p>
    <blockquote
      class="mt-kt-2 border-l-2 pl-kt-3 text-kt-xs italic text-kt-text-muted"
      :class="critical ? 'border-kt-warning' : 'border-kt-border-strong'"
    >
      “{{ takeaway.sourceQuote }}”
    </blockquote>
    <p v-if="takeaway.page" class="mt-kt-2 text-kt-xs text-kt-text-faint">
      Page {{ takeaway.page }}
    </p>
  </li>
</template>
