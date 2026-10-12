<script setup lang="ts">
import type { KeyTakeaway } from '@klartext/bus-contract';

// One row in the panel's grouped Key Takeaway lists (issue #75, prototype
// variant C2): the takeaway's number — stable across both sections — its
// plain-English text, and a trailing page label. Selecting the row reveals
// its German source quote; `divider` draws the inset separator between rows.
defineProps<{
  takeaway: KeyTakeaway;
  number: number;
  critical?: boolean;
  selected?: boolean;
  divider?: boolean;
}>();
const emit = defineEmits<{ select: [] }>();
</script>

<template>
  <li class="relative">
    <span
      v-if="divider"
      aria-hidden="true"
      class="absolute left-12 right-0 top-0 h-px bg-kt-border"
    ></span>
    <button
      type="button"
      class="grid w-full grid-cols-[20px_1fr_auto] items-start gap-kt-3 px-kt-4 py-kt-3 text-left"
      :class="selected ? 'bg-kt-accent-tint' : 'hover:bg-kt-fill'"
      :aria-expanded="selected"
      @click="emit('select')"
    >
      <span
        class="mt-px grid h-kt-5 w-kt-5 place-items-center rounded-full text-kt-xs font-semibold"
        :class="critical ? 'bg-kt-warning text-kt-bg' : 'bg-kt-fill text-kt-text-muted'"
        >{{ number }}</span
      >
      <span class="min-w-0">
        <span class="text-kt-sm">{{ takeaway.text }}</span>
        <blockquote
          v-if="selected"
          lang="de"
          class="mt-kt-2 border-l-2 pl-kt-3 text-kt-xs italic text-kt-text-muted"
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
