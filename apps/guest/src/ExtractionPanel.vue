<script setup lang="ts">
import { computed } from 'vue';
import type { DocumentType, ExtractionRecord } from '@klartext/bus-contract';
import KeyTakeawayCard from './KeyTakeawayCard.vue';

// The insights panel (issue #26, layout per the ui-host-guest prototype):
// document-type label and provenance line, the plain-English summary,
// warning-tinted "Needs your attention" cards for CRITICAL Key Takeaways,
// then the normal Key Takeaways. A neutral block stands in for the sections
// when the Extraction came back INSUFFICIENT_CONTENT / UNSUPPORTED_DOCUMENT.
const props = defineProps<{ extraction: ExtractionRecord; documentTitle: string }>();

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
</script>

<template>
  <article class="min-h-screen bg-kt-canvas px-kt-5 py-kt-6 font-sans text-kt-text">
    <header>
      <span
        class="inline-block rounded-kt-sm bg-kt-fill px-kt-2 py-kt-1 text-kt-xs font-medium uppercase tracking-wide text-kt-text-muted"
      >
        {{ typeLabel }}
      </span>
      <h1 class="mt-kt-3 text-kt-lg font-semibold">{{ documentTitle }}</h1>
      <p class="mt-kt-1 text-kt-xs text-kt-text-faint">
        Translated from {{ sourceLanguage }} · Analyzed {{ analyzedAt }} · {{ extraction.model }}
      </p>
    </header>

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
