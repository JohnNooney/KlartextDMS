<script setup>
import { computed } from 'vue';

const props = defineProps({ view: { type: Object, required: true }, title: String });
const emit = defineEmits(['show-page', 'retry']);

const ex = computed(() => props.view.extraction);
const critical = computed(() => ex.value?.keyTakeaways.filter((k) => k.importance === 'CRITICAL') ?? []);
const normal = computed(() => ex.value?.keyTakeaways.filter((k) => k.importance !== 'CRITICAL') ?? []);
</script>

<template>
  <div class="h-screen overflow-y-auto bg-kt-bg text-kt-text text-[15px] leading-[1.45] antialiased">
    <!-- Opening / analyzing -->
    <section v-if="view.kind === 'opening' || view.kind === 'loading'" class="px-5 py-5" aria-busy="true">
      <div class="flex items-center gap-2.5">
        <span class="h-4 w-4 rounded-full border-2 border-kt-fill-strong border-t-kt-accent animate-spin"></span>
        <h1 class="text-[17px] font-semibold">{{ view.kind === 'opening' ? 'Opening…' : 'Analyzing document…' }}</h1>
      </div>
      <p v-if="view.kind === 'loading'" class="mt-1.5 text-[13px] text-kt-text-muted">
        This usually takes under a minute. You can keep browsing — you’ll get a notification when it’s ready.
      </p>
      <div class="mt-6 space-y-3 animate-pulse">
        <div class="h-3 w-24 rounded bg-kt-fill"></div>
        <div class="h-3 rounded bg-kt-fill"></div>
        <div class="h-3 w-11/12 rounded bg-kt-fill"></div>
        <div class="h-3 w-4/5 rounded bg-kt-fill"></div>
        <div class="mt-6 h-16 rounded-kt-md bg-kt-fill"></div>
        <div class="h-12 rounded-kt-md bg-kt-fill"></div>
      </div>
    </section>

    <!-- Processing error: retryable -->
    <section v-else-if="view.kind === 'error'" class="px-5 py-10 text-center">
      <div class="mx-auto grid h-12 w-12 place-items-center rounded-full bg-kt-danger-tint text-kt-danger">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 4.6 3.2 17a2 2 0 0 0 1.7 3h14.2a2 2 0 0 0 1.7-3L13.7 4.6a2 2 0 0 0-3.4 0zM12 9.5v4M12 16.8v.2"/></svg>
      </div>
      <h1 class="mt-3 text-[17px] font-semibold">Couldn’t analyze this document</h1>
      <p class="mx-auto mt-1 max-w-[280px] text-[13px] text-kt-text-muted">The analysis took too long to respond. Your document is safe — try again.</p>
      <button class="mt-4 h-8 rounded-lg bg-kt-accent px-4 text-[13px] font-medium text-white hover:opacity-90" @click="emit('retry')">Try again</button>
    </section>

    <!-- Content status: not a failure, not retryable -->
    <section v-else-if="view.kind === 'insufficient'" class="px-5 py-10 text-center">
      <div class="mx-auto grid h-12 w-12 place-items-center rounded-full bg-kt-fill text-kt-text-muted">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 3.5h7l4.5 4.5v11a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 5 19V5a1.5 1.5 0 0 1 1.5-1.5zM13.5 3.5V8H18M9 13h6M9 16.5h4"/></svg>
      </div>
      <h1 class="mt-3 text-[17px] font-semibold">Not enough to read</h1>
      <p class="mx-auto mt-1 max-w-[280px] text-[13px] text-kt-text-muted">{{ ex.statusExplanation }}</p>
    </section>

    <!-- Complete Extraction -->
    <article v-else class="px-5 pb-8 pt-5">
      <header>
        <h1 class="text-[20px] font-bold leading-tight">{{ ex.label }}</h1>
        <p class="mt-1 text-[13px] text-kt-text-muted">Translated from {{ ex.sourceLanguage }} · Analyzed {{ ex.createdAt }}</p>
      </header>

      <section class="mt-5">
        <h2 class="text-[13px] font-semibold text-kt-text-muted">Summary</h2>
        <p class="mt-1.5">{{ ex.plainEnglishSummary }}</p>
      </section>

      <section v-if="critical.length" class="mt-6">
        <h2 class="text-[13px] font-semibold text-kt-text-muted">Needs your attention</h2>
        <ul class="mt-2 space-y-2">
          <li v-for="(k, i) in critical" :key="i" class="rounded-kt-md bg-kt-warning-tint p-3">
            <div class="flex gap-2.5">
              <svg class="mt-0.5 shrink-0 text-kt-warning" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 4.6 3.2 17a2 2 0 0 0 1.7 3h14.2a2 2 0 0 0 1.7-3L13.7 4.6a2 2 0 0 0-3.4 0zM12 9.5v4M12 16.8v.2"/></svg>
              <div class="min-w-0">
                <p class="font-medium">{{ k.text }}</p>
                <blockquote class="mt-1.5 border-l-2 border-[rgba(255,149,0,0.4)] pl-2 text-[13px] text-kt-text-muted" lang="de">“{{ k.sourceQuote }}”</blockquote>
                <button v-if="k.page" class="mt-1 text-[13px] font-medium text-kt-accent hover:underline" @click="emit('show-page', k.page)">Show on page {{ k.page }}</button>
              </div>
            </div>
          </li>
        </ul>
      </section>

      <section v-if="normal.length" class="mt-6">
        <h2 class="text-[13px] font-semibold text-kt-text-muted">Key takeaways</h2>
        <ul class="mt-1 divide-y divide-kt-border">
          <li v-for="(k, i) in normal" :key="i" class="py-3">
            <p>{{ k.text }}</p>
            <blockquote class="mt-1 border-l-2 border-kt-border pl-2 text-[13px] text-kt-text-muted" lang="de">“{{ k.sourceQuote }}”</blockquote>
            <button v-if="k.page" class="mt-1 text-[13px] font-medium text-kt-accent hover:underline" @click="emit('show-page', k.page)">Show on page {{ k.page }}</button>
          </li>
        </ul>
      </section>

      <p class="mt-6 text-[11px] text-kt-text-faint">Generated by {{ ex.model }}. A reading aid, not legal advice.</p>
    </article>
  </div>
</template>
