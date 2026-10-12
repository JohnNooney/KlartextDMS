<script setup lang="ts">
import type { KeyTakeaway } from '@klartext/bus-contract';
import KeyTakeawayRow from './KeyTakeawayRow.vue';

// One HIG inset grouped list of Key Takeaway rows (issue #75): "Needs your
// attention" gets the warning tint and triangle, "Key takeaways" stays
// neutral. `section` is the stable data-section anchor; each row carries the
// takeaway's Extraction-wide number and its index for selection.
defineProps<{
  title: string;
  section: string;
  rows: { takeaway: KeyTakeaway; index: number; number: number }[];
  critical?: boolean;
  selectedIndex: number | null;
}>();
const emit = defineEmits<{ select: [index: number] }>();
</script>

<template>
  <section :data-section="section" class="mt-kt-6 scroll-mt-kt-2">
    <h2 class="flex items-center gap-kt-2 text-kt-sm font-semibold text-kt-text-muted">
      <svg
        v-if="critical"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.9"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="text-kt-warning"
        aria-hidden="true"
      >
        <path d="M12 3.8 2.9 19.5h18.2z" /><path d="M12 10v4" /><path d="M12 16.9v.2" />
      </svg>
      {{ title }}
    </h2>
    <ul
      class="mt-kt-2 overflow-hidden rounded-kt-lg border bg-kt-bg"
      :class="critical ? 'border-kt-warning/40' : 'border-kt-border'"
    >
      <KeyTakeawayRow
        v-for="(row, i) in rows"
        :key="row.index"
        :takeaway="row.takeaway"
        :number="row.number"
        :critical="critical"
        :selected="selectedIndex === row.index"
        :divider="i > 0"
        @select="emit('select', row.index)"
      />
    </ul>
  </section>
</template>
