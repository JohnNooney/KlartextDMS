<script setup lang="ts">
import { ref } from 'vue';
import type { ActionTiming, KeyTakeaway } from '@klartext/bus-contract';
import KeyTakeawayRow from './KeyTakeawayRow.vue';

// One HIG inset grouped list of Key Takeaway rows (issue #75): "Needs your
// attention" is marked by its title alone — the list itself stays neutral
// like "Key takeaways", since colour means Urgency, shown per item on the
// timing chip (ADR 0012). `section` is the stable data-section anchor; each
// row carries the takeaway's index for selection.
//
// Issue #144: Action Item rows lead with the "Mark done" check. `doneRows`
// renders the collapsed "Done (n)" group at the bottom — muted, no Urgency
// chip, no Reminder; unticking a row emits toggleDone so it returns.
const props = defineProps<{
  title: string;
  section: string;
  rows: { takeaway: KeyTakeaway & { timing?: ActionTiming }; index: number }[];
  /** The collapsed Done group — Action Items only (issue #144). */
  doneRows?: { takeaway: KeyTakeaway & { timing?: ActionTiming }; index: number }[];
  /** Shows each row's "Add reminder" button — Action Items only (issue #122). */
  remindable?: boolean;
  /** Shows each row's "Mark done" check — Action Items only (issue #144). */
  checkable?: boolean;
  /** Every Action Item is Done — the section shows the empty message. */
  allDone?: boolean;
  selectedIndex: number | null;
}>();
const emit = defineEmits<{
  select: [index: number];
  remind: [index: number];
  toggleDone: [index: number];
}>();

const doneOpen = ref(false);
const hasDone = () => (props.doneRows?.length ?? 0) > 0;
</script>

<template>
  <section :data-section="section" class="mt-kt-6 scroll-mt-kt-2">
    <h2 class="text-kt-sm font-semibold text-kt-text-muted">{{ title }}</h2>
    <p v-if="allDone" class="mt-kt-2 text-kt-sm text-kt-text-muted">
      Nothing needs your attention.
    </p>
    <ul
      v-if="rows.length"
      class="mt-kt-2 overflow-hidden rounded-kt-lg border border-kt-border bg-kt-bg"
    >
      <KeyTakeawayRow
        v-for="(row, i) in rows"
        :key="row.index"
        :takeaway="row.takeaway"
        :remindable="remindable"
        :checkable="checkable"
        :selected="selectedIndex === row.index"
        :divider="i > 0"
        @select="emit('select', row.index)"
        @remind="emit('remind', row.index)"
        @toggle-done="emit('toggleDone', row.index)"
      />
    </ul>
    <template v-if="hasDone()">
      <button
        type="button"
        class="mt-kt-3 flex items-center gap-kt-1 text-kt-sm font-medium text-kt-text-faint"
        :aria-expanded="doneOpen"
        @click="doneOpen = !doneOpen"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
          :class="{ 'rotate-90': doneOpen }"
          class="transition-transform"
        ><path d="m9 6 6 6-6 6"/></svg>
        Done ({{ doneRows!.length }})
      </button>
      <ul
        v-if="doneOpen"
        class="mt-kt-2 overflow-hidden rounded-kt-lg border border-kt-border bg-kt-bg"
      >
        <KeyTakeawayRow
          v-for="(row, i) in doneRows"
          :key="row.index"
          :takeaway="row.takeaway"
          :checkable="true"
          :done="true"
          :divider="i > 0"
          @select="emit('select', row.index)"
          @toggle-done="emit('toggleDone', row.index)"
        />
      </ul>
    </template>
  </section>
</template>
