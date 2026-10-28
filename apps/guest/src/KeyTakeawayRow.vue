<script setup lang="ts">
import { computed } from 'vue';
import type { ActionTiming, KeyTakeaway } from '@klartext/bus-contract';

// One row in the panel's grouped Key Takeaway lists (issue #75, prototype
// variant C2): the plain-English text and a trailing page label. Selecting
// the row reveals its German source quote; `divider` draws the inset
// separator between rows. Action Item rows lead with the "Add reminder"
// affordance (issue #122).
const props = defineProps<{
  takeaway: KeyTakeaway & { timing?: ActionTiming };
  critical?: boolean;
  /** Offers the Action Item's "Add reminder" button (issue #122). */
  remindable?: boolean;
  selected?: boolean;
  divider?: boolean;
}>();
const emit = defineEmits<{ select: []; remind: [] }>();

// Timing chip per Action Item kind (issue #118); NONE and Key Takeaways get none.
const UNITS = { DAYS: 'day', WEEKS: 'week', MONTHS: 'month', YEARS: 'year' } as const;
const timingChip = computed(() => {
  const timing = props.takeaway.timing;
  switch (timing?.kind) {
    case 'FIXED_DATE':
      return `Due ${new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${timing.dueDate}T00:00:00Z`))}`;
    case 'RECURRING':
      return timing.scheduleLabel;
    case 'NOTICE_PERIOD': {
      const { duration, unit, anchor } = timing;
      const word = UNITS[unit] + (duration === 1 ? '’s' : 's’');
      return `${duration} ${word} notice · ${anchor}`;
    }
    default:
      return null;
  }
});
</script>

<template>
  <li
    class="relative flex items-start"
    :class="selected ? 'bg-kt-accent-tint' : 'hover:bg-kt-fill'"
  >
    <span
      v-if="divider"
      aria-hidden="true"
      class="absolute right-0 top-0 h-px bg-kt-border"
      :class="remindable ? 'left-13' : 'left-4'"
    ></span>
    <button
      v-if="remindable"
      type="button"
      class="ml-kt-3 mr-kt-2 mt-kt-3 grid size-8 shrink-0 place-items-center rounded-kt-sm text-kt-text-muted hover:bg-kt-fill hover:text-kt-accent"
      title="Add reminder"
      aria-label="Add reminder"
      @click="emit('remind')"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="16" rx="2.5"/><path d="M8 3v4M16 3v4M3.5 10h17"/><path d="M12 13v4M10 15h4"/></svg>
    </button>
    <button
      type="button"
      class="grid min-w-0 flex-1 grid-cols-[1fr_auto] items-start gap-kt-3 py-kt-3 pr-kt-4 text-left"
      :class="remindable ? 'pl-0' : 'pl-kt-4'"
      :aria-expanded="selected"
      @click="emit('select')"
    >
      <span class="min-w-0">
        <span class="text-kt-sm">{{ takeaway.text }}</span>
        <span
          v-if="timingChip"
          data-timing-chip
          class="mt-kt-1 block w-fit rounded-full bg-kt-fill px-kt-2 py-px text-kt-xs font-medium text-kt-text-muted"
          >{{ timingChip }}</span
        >
        <blockquote
          v-if="selected"
          lang="de"
          class="mt-kt-2 border-l-2 pl-kt-3 text-kt-sm italic text-kt-text-muted"
          :class="critical ? 'border-kt-warning' : 'border-kt-border-strong'"
        >
          “{{ takeaway.sourceQuote }}”
        </blockquote>
      </span>
      <span v-if="takeaway.page" class="mt-0.5 whitespace-nowrap text-kt-xs text-kt-accent"
        >p. {{ takeaway.page }}</span
      >
    </button>
  </li>
</template>
