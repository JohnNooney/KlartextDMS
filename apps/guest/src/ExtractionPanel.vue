<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import type {
  DocumentType,
  ExtractionRecord,
  ExtractionState,
  GuestShowPagePayload,
  PanelPresentation,
} from '@klartext/bus-contract';
import TakeawaySection from './TakeawaySection.vue';

// The insights panel as one continuous scroll (issue #75, layout settled by
// the reader-insights prototype's variant C2): the document-type label is
// the title — the Host toolbar already names the Document — with a muted
// language/date meta line (the model moved into the ⋯ menu). The summary,
// a tinted "things need your attention" callout that scrolls to the
// Critical Warnings, then HIG inset grouped lists of Key Takeaway rows
// numbered by their place in the Extraction; a row's German source quote
// expands on selection. Sections carry data-section anchors — the attention
// callout and the lane-mode outline rail (issue #77) scroll to them. A
// neutral block stands in for the sections
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
    extractionState?: ExtractionState;
    presentation?: PanelPresentation | null;
  }>(),
  { extractionState: 'none', presentation: null },
);

const emit = defineEmits<{
  reanalyze: [];
  /** A paged Key Takeaway row was selected (issue #78) — the Host jumps. */
  showPage: [request: GuestShowPagePayload];
  /** A jump-bar segment was tapped (issue #79) — the Host raises the sheet. */
  expandPanel: [];
}>();
const menuOpen = ref(false);
const root = ref<HTMLElement>();

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

// Rows are numbered continuously across both sections (Action Items 1..M,
// Key Takeaways M+1..M+K); `index` is the same position, used for selection.
const criticalTakeaways = computed(() =>
  props.extraction.actionItems.map((takeaway, index) => ({ takeaway, index, number: index + 1 })),
);
const normalTakeaways = computed(() =>
  props.extraction.keyTakeaways.map((takeaway, i) => {
    const index = props.extraction.actionItems.length + i;
    return { takeaway, index, number: index + 1 };
  }),
);

// The outline rail (issue #77, prototype variant C2): a slim icon rail on
// the panel's trailing edge — one button per rendered section with count
// badges — shown only while the Host reports the lane presentation. A
// button jumps to its section; scroll-spy tracks the current section as the
// panel scrolls (the document itself is the scroller — the panel is one
// continuous page).
const showOutline = computed(() => props.presentation === 'lane');

// The jump bar (issue #79, prototype variant C2 mobile): the same outline
// as an HIG segmented control pinned at the top of the Guest's content —
// visible and tappable at every sheet detent including peek, where the
// Host clips the frame to its top sliver. A tap scrolls the section and
// emits `expandPanel` so the Host can raise a peeking sheet; the same
// scroll-spy marks the current segment.
const showJumpBar = computed(() => props.presentation === 'sheet');

type SectionId = 'summary' | 'attention' | 'takeaways';

/** Short labels for the segmented control — the rail uses the full ones. */
const JUMP_LABELS: Record<SectionId, string> = {
  summary: 'Summary',
  attention: 'Attention',
  takeaways: 'Takeaways',
};

const OUTLINE_ICONS: Record<SectionId, string> = {
  summary: 'M4 6h16M4 10h11M4 14h16M4 18h9',
  attention: 'M12 3.8 2.9 19.5h18.2zM12 10v4M12 16.9v.2',
  takeaways: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
};

interface OutlineItem {
  id: SectionId;
  label: string;
  icon: string;
  count?: number;
  critical?: boolean;
}

const outlineItems = computed<OutlineItem[]>(() => {
  const items: OutlineItem[] = [
    { id: 'summary', label: 'Summary', icon: OUTLINE_ICONS.summary },
  ];
  if (isComplete.value && criticalTakeaways.value.length) {
    items.push({
      id: 'attention',
      label: 'Needs your attention',
      icon: OUTLINE_ICONS.attention,
      count: criticalTakeaways.value.length,
      critical: true,
    });
  }
  if (isComplete.value && normalTakeaways.value.length) {
    items.push({
      id: 'takeaways',
      label: 'Key takeaways',
      icon: OUTLINE_ICONS.takeaways,
      count: normalTakeaways.value.length,
    });
  }
  return items;
});

const jumpItems = computed(() =>
  outlineItems.value.map((item) => ({ ...item, label: JUMP_LABELS[item.id] })),
);

const activeSection = ref<string | null>(null);
/** How far past the top edge a section counts as "current". */
const SCROLL_SPY_TOP_PX = 40;
/** Sections scrolled under the jump bar (52px scroll-margin) count as
 *  current — +1px for scrollIntoView's sub-pixel landing. */
const SHEET_SPY_TOP_PX = 53;

function updateScrollSpy(): void {
  const sections = root.value
    ? [...root.value.querySelectorAll<HTMLElement>('[data-section]')]
    : [];
  if (!sections.length) return;
  const spyTop = showJumpBar.value ? SHEET_SPY_TOP_PX : SCROLL_SPY_TOP_PX;
  // scrollY > 0 too: a document that never overflows the frame shouldn't pin
  // the last section as "current".
  const atBottom =
    window.scrollY > 0 &&
    window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 4;
  let active = sections[0]!.dataset['section']!;
  if (atBottom) {
    active = sections.at(-1)!.dataset['section']!;
  } else {
    for (const s of sections) {
      if (s.getBoundingClientRect().top <= spyTop) {
        active = s.dataset['section']!;
      }
    }
  }
  activeSection.value = active;
}

onMounted(() => {
  window.addEventListener('scroll', updateScrollSpy, { passive: true });
  updateScrollSpy();
});
onUnmounted(() => window.removeEventListener('scroll', updateScrollSpy));

// A selected row shows its source quote; selection is single — picking
// another row collapses the first, re-picking collapses it too.
const selectedTakeaway = ref<number | null>(null);
function toggleTakeaway(index: number): void {
  const selecting = selectedTakeaway.value !== index;
  selectedTakeaway.value = selecting ? index : null;
  // Selecting a paged row also asks the Host to show that page (issue #78);
  // deselecting stays silent.
  const actionCount = props.extraction.actionItems.length;
  const isActionItem = index < actionCount;
  const takeaway = isActionItem
    ? props.extraction.actionItems[index]
    : props.extraction.keyTakeaways[index - actionCount];
  if (selecting && takeaway?.page !== undefined) {
    emit('showPage', {
      page: takeaway.page,
      quote: takeaway.sourceQuote,
      critical: isActionItem,
    });
  }
}
watch(
  () => props.extraction,
  () => {
    selectedTakeaway.value = null;
    void nextTick(updateScrollSpy);
  },
);
// The first PANEL_PRESENTATION often lands after mount — refresh the spy once
// the rail (and its sections' final positions) has rendered.
watch(
  () => props.presentation,
  () => void nextTick(updateScrollSpy),
);

function scrollToSection(section: SectionId): void {
  root.value
    ?.querySelector(`[data-section="${section}"]`)
    ?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

function jumpToSection(section: SectionId): void {
  // The sheet may sit at peek — the Guest can't raise its own frame, so the
  // Host hears every tap and lifts a peeking sheet to half (issue #79).
  emit('expandPanel');
  scrollToSection(section);
}

const jobInFlight = computed(
  () => props.extractionState === 'queued' || props.extractionState === 'running',
);

// The failed re-analysis banner is dismissible (#32); a new failure after
// another retry re-shows it.
const bannerDismissed = ref(false);
watch(
  () => props.extractionState,
  (state) => {
    if (state !== 'failed') bannerDismissed.value = false;
  },
);

function reanalyze(): void {
  menuOpen.value = false;
  emit('reanalyze');
}
</script>

<template>
  <article
    ref="root"
    class="flex min-h-screen bg-kt-canvas font-sans text-kt-text"
    :class="{ 'in-sheet': showJumpBar }"
  >
    <div class="min-w-0 flex-1 px-kt-5 py-kt-6">
      <nav
        v-if="showJumpBar"
        aria-label="Jump to section"
        class="sticky top-0 z-10 -mx-kt-5 -mt-kt-6 mb-kt-4 flex h-kt-touch items-center border-b border-kt-border bg-kt-canvas px-kt-4"
      >
        <div class="flex w-full rounded-[9px] bg-kt-fill p-[2px]">
          <button
            v-for="item in jumpItems"
            :key="item.id"
            type="button"
            class="flex h-8 flex-1 items-center justify-center gap-kt-1 rounded-[7px] text-kt-sm font-medium"
            :class="{ 'bg-kt-bg shadow-sm': activeSection === item.id }"
            :aria-current="activeSection === item.id ? 'location' : undefined"
            @click="jumpToSection(item.id)"
          >
            {{ item.label }}
            <span
              v-if="item.critical && item.count"
              class="flex h-5 min-w-5 items-center justify-center rounded-full bg-kt-warning px-1.5 text-[12px] font-bold leading-none text-kt-canvas"
            >{{ item.count }}</span>
          </button>
        </div>
      </nav>
      <header class="flex items-start justify-between gap-kt-3">
        <div class="min-w-0">
          <h1 class="text-kt-lg font-semibold">{{ typeLabel }}</h1>
          <p class="mt-kt-1 text-kt-xs text-kt-text-muted">
            Translated from {{ sourceLanguage }} · Analyzed {{ analyzedAt }}
          </p>
        </div>
        <div v-if="isComplete" class="relative shrink-0">
          <button
            type="button"
            aria-label="More actions"
            class="rounded-kt-sm px-kt-2 py-kt-1 text-kt-lg leading-none text-kt-text-muted hover:bg-kt-fill"
            @click="menuOpen = !menuOpen"
          >
            ⋯
          </button>
          <div
            v-if="menuOpen"
            class="absolute right-0 z-10 mt-kt-1 min-w-48 rounded-kt-md bg-kt-surface py-kt-1 shadow-kt-popover"
          >
            <p class="whitespace-nowrap px-kt-4 pb-kt-1 pt-kt-2 text-kt-xs text-kt-text-faint">
              Analyzed with {{ extraction.model }}
            </p>
            <p
              v-if="extraction.schemaVersion === 1"
              class="max-w-56 px-kt-4 pb-kt-1 text-kt-xs text-kt-text-faint"
            >
              Earlier analysis format — re-analyze for dates
            </p>
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
        v-else-if="extractionState === 'failed' && !bannerDismissed"
        class="mt-kt-4 flex items-start justify-between gap-kt-3 rounded-kt-md border border-kt-warning bg-kt-warning-tint p-kt-3 text-kt-sm"
        role="status"
      >
        <p>Couldn't re-analyze — showing the result from {{ analyzedAt }}.</p>
        <div class="flex shrink-0 items-center gap-kt-2">
          <button type="button" class="font-medium underline" @click="reanalyze">
            Try again
          </button>
          <button
            type="button"
            aria-label="Dismiss warning"
            class="rounded-kt-sm p-kt-1 text-kt-text-muted hover:bg-kt-fill"
            @click="bannerDismissed = true"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg>
          </button>
        </div>
      </div>

      <section data-section="summary" class="mt-kt-4 scroll-mt-kt-2">
        <p class="text-kt-base leading-relaxed">{{ extraction.plainEnglishSummary }}</p>
        <button
          v-if="isComplete && criticalTakeaways.length"
          type="button"
          class="mt-kt-5 flex w-full items-center gap-kt-3 rounded-kt-lg bg-kt-warning-tint px-kt-4 py-kt-3 text-left text-kt-sm font-medium"
          @click="scrollToSection('attention')"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="shrink-0 text-kt-warning" aria-hidden="true"><path d="M12 3.8 2.9 19.5h18.2z"/><path d="M12 10v4"/><path d="M12 16.9v.2"/></svg>
          <span class="flex-1">{{ criticalTakeaways.length }} things need your attention</span>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="text-kt-text-muted" aria-hidden="true"><path d="M9.5 5.5 16 12l-6.5 6.5"/></svg>
        </button>
      </section>

      <div
        v-if="!isComplete"
        class="mt-kt-4 rounded-kt-md bg-kt-fill p-kt-4 text-kt-sm text-kt-text-muted"
      >
        {{ extraction.statusExplanation }}
      </div>

      <template v-else>
        <TakeawaySection
          v-if="criticalTakeaways.length"
          section="attention"
          title="Needs your attention"
          :rows="criticalTakeaways"
          critical
          :selected-index="selectedTakeaway"
          @select="toggleTakeaway"
        />
        <TakeawaySection
          v-if="normalTakeaways.length"
          section="takeaways"
          title="Key takeaways"
          :rows="normalTakeaways"
          :selected-index="selectedTakeaway"
          @select="toggleTakeaway"
        />
      </template>
    </div>

    <nav
      v-if="showOutline"
      aria-label="Insights outline"
      class="sticky top-0 flex h-screen w-14 shrink-0 flex-col items-center gap-kt-2 self-start border-l border-kt-border py-kt-3"
    >
      <button
        v-for="item in outlineItems"
        :key="item.id"
        type="button"
        class="relative grid size-11 place-items-center rounded-[10px] hover:bg-kt-fill"
        :class="activeSection === item.id ? 'text-kt-accent' : 'text-kt-text-muted'"
        :title="item.label"
        :aria-label="item.label"
        :aria-current="activeSection === item.id ? 'location' : undefined"
        @click="scrollToSection(item.id)"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="item.icon" /></svg>
        <span
          v-if="activeSection === item.id"
          class="absolute -left-[6px] bottom-[10px] top-[10px] w-[3px] rounded-full bg-kt-accent"
          aria-hidden="true"
        ></span>
        <span
          v-if="item.count"
          class="absolute right-0 top-0 flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[12px] font-bold leading-none"
          :class="item.critical ? 'bg-kt-warning text-kt-canvas' : 'bg-kt-fill-strong text-kt-text'"
        >{{ item.count }}</span>
      </button>
    </nav>
  </article>
</template>

<style scoped>
/* The pinned jump bar (44px) plus a small gap — a segment's scrollIntoView
   must not land the section under the bar (issue #79). */
.in-sheet :deep([data-section]) {
  scroll-margin-top: 52px;
}
</style>
