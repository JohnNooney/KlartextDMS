<script setup lang="ts">
import { computed, ref } from 'vue';
import type { DocumentType, ExtractionRecord, ExtractionState } from '@klartext/bus-contract';
import KeyTakeawayCard from './KeyTakeawayCard.vue';

// The insights panel (issue #26, layout per the ui-host-guest prototype):
// document-type label and provenance line, the plain-English summary,
// warning-tinted "Needs your attention" cards for CRITICAL Key Takeaways,
// then the normal Key Takeaways. A neutral block stands in for the sections
// when the Extraction came back INSUFFICIENT_CONTENT / UNSUPPORTED_DOCUMENT.
//
// Issue #15/#31: the stored Extraction stays readable whatever the job is
// doing — a queued/running re-analysis only adds an indicator, a failed one
// a dismissible warning banner with Try again. "Re-analyze document" lives
// in the ⋯ header menu, hidden on non-COMPLETE statuses and disabled while
// a job for this Document is in flight. All three emit `reanalyze`; the App
// turns it into RETRY_EXTRACTION.
const props = withDefaults(
  defineProps<{
    extraction: ExtractionRecord;
    documentTitle: string;
    extractionState?: ExtractionState;
  }>(),
  { extractionState: 'none' },
);

const emit = defineEmits<{ reanalyze: [] }>();
const menuOpen = ref(false);

const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  TENANCY_AGREEMENT: 'Tenancy agreement',
  HEALTH_INSURANCE: 'Health insurance',
  EMPLOYMENT_CONTRACT: 'Employment contract',
  INTERNET_OR_PHONE: 'Internet or phone contract',
  GOVERNMENT_LETTER: 'Government letter',
  OTHER: 'Other',
};

const typeLabel = computed(() =>
  props.extraction.documentType === 'OTHER'
    ? (props.extraction.documentTypeLabel ?? DOCUMENT_TYPE_LABELS.OTHER)
    : DOCUMENT_TYPE_LABELS[props.extraction.documentType],
);

const sourceLanguage = computed(
  () =>
    new Intl.DisplayNames('en', { type: 'language' }).of(props.extraction.sourceLanguage) ??
    props.extraction.sourceLanguage,
);

const analyzedAt = computed(() =>
  new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(
    new Date(props.extraction.createdAt.seconds * 1000),
  ),
);

const isComplete = computed(() => props.extraction.extractionStatus === 'COMPLETE');
const criticalTakeaways = computed(() =>
  props.extraction.keyTakeaways.filter((t) => t.importance === 'CRITICAL'),
);
const normalTakeaways = computed(() =>
  props.extraction.keyTakeaways.filter((t) => t.importance !== 'CRITICAL'),
);

const jobInFlight = computed(
  () => props.extractionState === 'queued' || props.extractionState === 'running',
);

function reanalyze(): void {
  menuOpen.value = false;
  emit('reanalyze');
}
</script>

<template>
  <article class="min-h-screen bg-kt-canvas px-kt-5 py-kt-6 font-sans text-kt-text">
    <header>
      <div class="flex items-start justify-between gap-kt-3">
        <span
          class="inline-block rounded-kt-sm bg-kt-fill px-kt-2 py-kt-1 text-kt-xs font-medium uppercase tracking-wide text-kt-text-muted"
        >
          {{ typeLabel }}
        </span>
        <div v-if="isComplete" class="relative">
          <button
            type="button"
            aria-label="More actions"
            class="rounded-kt-sm px-kt-2 py-kt-1 text-kt-base leading-none text-kt-text-muted hover:bg-kt-fill"
            @click="menuOpen = !menuOpen"
          >
            ⋯
          </button>
          <div
            v-if="menuOpen"
            class="absolute right-0 z-10 mt-kt-1 min-w-40 rounded-kt-md bg-kt-surface py-kt-1 shadow-kt-panel"
          >
            <button
              type="button"
              class="block w-full px-kt-4 py-kt-2 text-left text-kt-sm hover:bg-kt-fill disabled:opacity-50"
              :disabled="jobInFlight"
              @click="reanalyze"
            >
              Re-analyze document
            </button>
          </div>
        </div>
      </div>
      <h1 class="mt-kt-3 text-kt-lg font-semibold">{{ documentTitle }}</h1>
      <p class="mt-kt-1 text-kt-xs text-kt-text-faint">
        Translated from {{ sourceLanguage }} · Analyzed {{ analyzedAt }} · {{ extraction.model }}
      </p>
    </header>

    <p
      v-if="extractionState === 'queued'"
      class="mt-kt-4 rounded-kt-md bg-kt-fill p-kt-3 text-kt-sm text-kt-text-muted"
    >
      Re-analysis queued…
    </p>
    <p
      v-else-if="extractionState === 'running'"
      class="mt-kt-4 rounded-kt-md bg-kt-fill p-kt-3 text-kt-sm text-kt-text-muted"
    >
      Re-analyzing…
    </p>
    <div
      v-else-if="extractionState === 'failed'"
      class="mt-kt-4 flex items-start justify-between gap-kt-3 rounded-kt-md border border-kt-warning bg-kt-warning-tint p-kt-3 text-kt-sm"
    >
      <p>Couldn't re-analyze — showing the result from {{ analyzedAt }}.</p>
      <button type="button" class="shrink-0 font-medium underline" @click="reanalyze">
        Try again
      </button>
    </div>

    <p class="mt-kt-4 text-kt-base leading-relaxed">{{ extraction.plainEnglishSummary }}</p>

    <div
      v-if="!isComplete"
      class="mt-kt-4 rounded-kt-md bg-kt-fill p-kt-4 text-kt-sm text-kt-text-muted"
    >
      {{ extraction.statusExplanation }}
    </div>

    <template v-else>
      <section v-if="criticalTakeaways.length" class="mt-kt-6">
        <h2 class="text-kt-sm font-semibold">Needs your attention</h2>
        <ul class="mt-kt-2 space-y-kt-3">
          <KeyTakeawayCard
            v-for="(takeaway, i) in criticalTakeaways"
            :key="i"
            :takeaway="takeaway"
            critical
          />
        </ul>
      </section>

      <section v-if="normalTakeaways.length" class="mt-kt-6">
        <h2 class="text-kt-sm font-semibold">Key takeaways</h2>
        <ul class="mt-kt-2 space-y-kt-2">
          <KeyTakeawayCard
            v-for="(takeaway, i) in normalTakeaways"
            :key="i"
            :takeaway="takeaway"
          />
        </ul>
      </section>
    </template>
  </article>
</template>
