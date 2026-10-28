<script setup lang="ts">
import type { ActionTiming, KeyTakeaway } from '@klartext/bus-contract';
import KeyTakeawayRow from './KeyTakeawayRow.vue';

// One HIG inset grouped list of Key Takeaway rows (issue #75): "Needs your
// attention" is marked by its title alone — the list itself stays neutral
// like "Key takeaways", since colour means Urgency, shown per item on the
// timing chip (ADR 0012). `section` is the stable data-section anchor; each
// row carries the takeaway's index for selection.
defineProps<{
  title: string;
  section: string;
  rows: { takeaway: KeyTakeaway & { timing?: ActionTiming }; index: number }[];
  /** Shows each row's "Add reminder" button — Action Items only (issue #122). */
  remindable?: boolean;
  selectedIndex: number | null;
}>();
const emit = defineEmits<{ select: [index: number]; remind: [index: number] }>();
</script>

<template>
  <section :data-section="section" class="mt-kt-6 scroll-mt-kt-2">
    <h2 class="text-kt-sm font-semibold text-kt-text-muted">{{ title }}</h2>
    <ul class="mt-kt-2 overflow-hidden rounded-kt-lg border border-kt-border bg-kt-bg">
      <KeyTakeawayRow
        v-for="(row, i) in rows"
        :key="row.index"
        :takeaway="row.takeaway"
        :remindable="remindable"
        :selected="selectedIndex === row.index"
        :divider="i > 0"
        @select="emit('select', row.index)"
        @remind="emit('remind', row.index)"
      />
    </ul>
  </section>
</template>
