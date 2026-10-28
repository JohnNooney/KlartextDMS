import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { goldenFixtureMessages } from '@klartext/bus-contract';
import type { ExtractionRecord, IdentifiedActionItem, KeyTakeaway } from '@klartext/bus-contract';
import ExtractionPanel from './ExtractionPanel.vue';

const fixture = goldenFixtureMessages.INIT_SESSION.payload.extraction!;
const stored = goldenFixtureMessages.AI_PROCESSING_SUCCESS.payload.extraction;

function record(extraction: Partial<ExtractionRecord>): ExtractionRecord {
  return {
    ...stored,
    ...extraction,
    createdAt: { seconds: 1710500400, nanoseconds: 0 },
  } as ExtractionRecord;
}

function takeaway(partial: Partial<KeyTakeaway>): KeyTakeaway {
  return { text: 'x', sourceQuote: 'q', ...partial };
}

function actionItem(partial: Partial<IdentifiedActionItem>): IdentifiedActionItem {
  return { id: `ai_${partial.text ?? 'x'}`, text: 'x', sourceQuote: 'q', timing: { kind: 'NONE' }, ...partial };
}

const attentionButton = (wrapper: ReturnType<typeof mount>) =>
  wrapper.findAll('button').find((b) => b.text().includes('need your attention'));

describe('ExtractionPanel', () => {
  // Issue #75: one continuous scroll (prototype variant C2). The panel title
  // is the document-type label — the Host toolbar already names the Document.

  it('renders the document-type label as the panel title', () => {
    const wrapper = mount(ExtractionPanel, { props: { extraction: fixture } });
    expect(wrapper.find('h1').text()).toBe('Tenancy agreement');
  });

  it('uses documentTypeLabel for OTHER Extractions', () => {
    const wrapper = mount(ExtractionPanel, { props: { extraction: record({}) } });
    expect(wrapper.find('h1').text()).toBe('Service charge statement');
  });

  it('shows language and analysis date in the meta line, not the model', () => {
    const wrapper = mount(ExtractionPanel, { props: { extraction: fixture } });
    const meta = wrapper.find('header').text();
    expect(meta).toContain('Translated from German');
    expect(meta).toContain('Analyzed');
    expect(meta).not.toContain('gemini-2.5-flash');
  });

  it('shows the model name inside the ⋯ menu', async () => {
    const wrapper = mount(ExtractionPanel, { props: { extraction: fixture } });
    await wrapper.find('button[aria-label="More actions"]').trigger('click');
    expect(wrapper.text()).toContain('gemini-2.5-flash');
    expect(wrapper.text()).toContain('Re-analyze document');
  });

  // The "N things need your attention ›" callout exists only while Critical
  // Warnings do, and jumps to their section.

  it('offers an attention callout carrying the Critical Warning count', () => {
    const two = record({
      extractionStatus: 'COMPLETE',
      actionItems: [actionItem({ text: 'a' }), actionItem({ text: 'c' })],
      keyTakeaways: [takeaway({ text: 'b' })],
    });
    const wrapper = mount(ExtractionPanel, { props: { extraction: two } });
    expect(attentionButton(wrapper)?.text()).toContain('2 things need your attention');
  });

  it('omits the attention callout when nothing is critical', () => {
    const calm = record({
      extractionStatus: 'COMPLETE',
      actionItems: [],
      keyTakeaways: [takeaway({ text: 'a' }), takeaway({ text: 'b' })],
    });
    const wrapper = mount(ExtractionPanel, { props: { extraction: calm } });
    expect(attentionButton(wrapper)).toBeUndefined();
  });

  it('scrolls to the Needs your attention section when the callout is pressed', async () => {
    const scrollIntoView = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoView;
    try {
      const wrapper = mount(ExtractionPanel, { props: { extraction: fixture } });
      await attentionButton(wrapper)!.trigger('click');

      const attention = wrapper.find('[data-section="attention"]');
      expect(attention.exists()).toBe(true);
      expect(scrollIntoView).toHaveBeenCalledOnce();
      expect(scrollIntoView.mock.contexts[0]).toBe(attention.element);
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it('anchors the summary, attention, and takeaways sections', () => {
    const wrapper = mount(ExtractionPanel, { props: { extraction: fixture } });
    expect(wrapper.find('[data-section="summary"]').exists()).toBe(true);
    expect(wrapper.find('[data-section="attention"]').exists()).toBe(true);
    expect(wrapper.find('[data-section="takeaways"]').exists()).toBe(true);
  });

  // Grouped-list rows: one per item — the plain-English text and a
  // trailing page label when the Extraction located one.

  it('renders Action Items first, then Key Takeaways — unnumbered', () => {
    const ex = record({
      extractionStatus: 'COMPLETE',
      actionItems: [actionItem({ text: 'critical mid', page: 2 })],
      keyTakeaways: [
        takeaway({ text: 'first normal', page: 1 }),
        takeaway({ text: 'last normal', page: 4 }),
      ],
    });
    const wrapper = mount(ExtractionPanel, { props: { extraction: ex } });

    const attention = wrapper.find('[data-section="attention"]');
    expect(attention.findAll('li')).toHaveLength(1);
    expect(attention.find('li').text()).toContain('critical mid');
    expect(attention.find('li').text()).toContain('p. 2');

    const takeaways = wrapper.find('[data-section="takeaways"]');
    const rows = takeaways.findAll('li');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.text()).toContain('first normal');
    expect(rows[0]!.text()).toContain('p. 1');
    expect(rows[1]!.text()).toContain('last normal');
    expect(rows[1]!.text()).toContain('p. 4');
  });

  it('omits the page label for takeaways without a page', () => {
    const ex = record({
      extractionStatus: 'COMPLETE',
      keyTakeaways: [takeaway({ text: 'unpaged' })],
    });
    const wrapper = mount(ExtractionPanel, { props: { extraction: ex } });
    expect(wrapper.find('[data-section="takeaways"] li').text()).not.toContain('p.');
  });

  it('reveals the German sourceQuote only for the selected row', async () => {
    const wrapper = mount(ExtractionPanel, { props: { extraction: fixture } });
    const critical = fixture.keyTakeaways[0]!;
    const row = wrapper
      .findAll('button')
      .find((b) => b.text().includes(critical.text))!;

    expect(wrapper.text()).not.toContain(critical.sourceQuote);
    expect(row.attributes('aria-expanded')).toBe('false');

    await row.trigger('click');
    expect(wrapper.find('blockquote[lang="de"]').text()).toContain(critical.sourceQuote);
    expect(row.attributes('aria-expanded')).toBe('true');

    // Selecting again collapses it.
    await row.trigger('click');
    expect(wrapper.text()).not.toContain(critical.sourceQuote);
  });

  // Issue #78: selecting a row carrying a page asks the Host to show it —
  // page, sourceQuote, and the Critical Warning flag ride in the payload.
  // Rows without a page stay silent.

  it('emits showPage with page, sourceQuote, and critical for a Critical Warning row', async () => {
    const ex = record({
      extractionStatus: 'COMPLETE',
      actionItems: [actionItem({ text: 'deadline', sourceQuote: 'Frist drei Monate', page: 3 })],
      keyTakeaways: [
        takeaway({ text: 'rent', sourceQuote: 'dritten Werktag', page: 2 }),
      ],
    });
    const wrapper = mount(ExtractionPanel, { props: { extraction: ex } });
    const row = wrapper.findAll('button').find((b) => b.text().includes('deadline'))!;

    await row.trigger('click');

    expect(wrapper.emitted('showPage')).toEqual([
      [{ page: 3, quote: 'Frist drei Monate', critical: true }],
    ]);
  });

  it('marks an ordinary takeaway as not critical', async () => {
    const ex = record({
      extractionStatus: 'COMPLETE',
      keyTakeaways: [takeaway({ text: 'rent', sourceQuote: 'dritten Werktag', page: 2 })],
    });
    const wrapper = mount(ExtractionPanel, { props: { extraction: ex } });
    const row = wrapper.findAll('button').find((b) => b.text().includes('rent'))!;

    await row.trigger('click');

    expect(wrapper.emitted('showPage')).toEqual([
      [{ page: 2, quote: 'dritten Werktag', critical: false }],
    ]);
  });

  it('resolves a Key Takeaway row correctly when Action Items precede it', async () => {
    const ex = record({
      extractionStatus: 'COMPLETE',
      actionItems: [actionItem({ text: 'deadline', sourceQuote: 'Frist', page: 3 })],
      keyTakeaways: [takeaway({ text: 'rent', sourceQuote: 'dritten Werktag', page: 2 })],
    });
    const wrapper = mount(ExtractionPanel, { props: { extraction: ex } });
    await wrapper.findAll('button').find((b) => b.text().includes('rent'))!.trigger('click');
    expect(wrapper.emitted('showPage')).toEqual([
      [{ page: 2, quote: 'dritten Werktag', critical: false }],
    ]);
  });

  it('emits nothing for a row without a page', async () => {
    const ex = record({
      extractionStatus: 'COMPLETE',
      keyTakeaways: [takeaway({ text: 'unpaged' })],
    });
    const wrapper = mount(ExtractionPanel, { props: { extraction: ex } });
    const row = wrapper.findAll('button').find((b) => b.text().includes('unpaged'))!;

    await row.trigger('click');

    expect(wrapper.emitted('showPage')).toBeUndefined();
  });

  it('stays silent when the click deselects the row', async () => {
    const ex = record({
      extractionStatus: 'COMPLETE',
      keyTakeaways: [takeaway({ text: 'rent', sourceQuote: 'q', page: 2 })],
    });
    const wrapper = mount(ExtractionPanel, { props: { extraction: ex } });
    const row = wrapper.findAll('button').find((b) => b.text().includes('rent'))!;

    await row.trigger('click'); // selects — sends
    await row.trigger('click'); // deselects — silent

    expect(wrapper.emitted('showPage')).toEqual([
      [{ page: 2, quote: 'q', critical: false }],
    ]);
  });

  it('collapses the previously selected row when another is selected', async () => {
    const ex = record({
      extractionStatus: 'COMPLETE',
      keyTakeaways: [
        takeaway({ text: 'one', sourceQuote: 'quote one' }),
        takeaway({ text: 'two', sourceQuote: 'quote two' }),
      ],
    });
    const wrapper = mount(ExtractionPanel, { props: { extraction: ex } });
    const [one, two] = ['one', 'two'].map(
      (text) => wrapper.findAll('button').find((b) => b.text().includes(text))!,
    );

    await one!.trigger('click');
    expect(wrapper.text()).toContain('quote one');

    await two!.trigger('click');
    expect(wrapper.text()).toContain('quote two');
    expect(wrapper.text()).not.toContain('quote one');
  });

  // Non-COMPLETE statuses (issue #15's matrix): the stored summary still
  // reads, the status explanation stands in for the sections.
  it.each(['INSUFFICIENT_CONTENT', 'UNSUPPORTED_DOCUMENT'] as const)(
    'renders a neutral block with statusExplanation for %s',
    (extractionStatus) => {
      const wrapper = mount(ExtractionPanel, {
        props: {
          extraction: record({
            extractionStatus,
            statusExplanation: 'Not enough readable text to explain this document.',
            actionItems: [],
            keyTakeaways: [],
          }),
        },
      });
      expect(wrapper.text()).toContain('Not enough readable text');
      expect(wrapper.text()).toContain(stored.plainEnglishSummary);
      expect(wrapper.text()).not.toContain('Needs your attention');
      expect(attentionButton(wrapper)).toBeUndefined();
      expect(wrapper.find('[data-section="attention"]').exists()).toBe(false);
    },
  );

  // Explicit re-run (issue #15): ⋯ → "Re-analyze document" — hidden on
  // non-COMPLETE statuses, disabled while a job is queued/running.

  it('offers "Re-analyze document" from the header menu and emits reanalyze', async () => {
    const wrapper = mount(ExtractionPanel, { props: { extraction: fixture } });
    await wrapper.find('button[aria-label="More actions"]').trigger('click');
    const item = wrapper.findAll('button').find((b) => b.text() === 'Re-analyze document');
    expect(item).toBeDefined();
    await item!.trigger('click');
    expect(wrapper.emitted('reanalyze')).toHaveLength(1);
  });

  it.each(['INSUFFICIENT_CONTENT', 'UNSUPPORTED_DOCUMENT'] as const)(
    'hides the re-analyze affordance for %s',
    (extractionStatus) => {
      const wrapper = mount(ExtractionPanel, {
        props: {
          extraction: record({ extractionStatus, statusExplanation: 'x', actionItems: [], keyTakeaways: [] }),
        },
      });
      expect(wrapper.find('button[aria-label="More actions"]').exists()).toBe(false);
    },
  );

  it.each(['queued', 'running'] as const)('disables re-analyze while %s', async (state) => {
    const wrapper = mount(ExtractionPanel, {
      props: { extraction: fixture, extractionState: state },
    });
    await wrapper.find('button[aria-label="More actions"]').trigger('click');
    const item = wrapper.findAll('button').find((b) => b.text() === 'Re-analyze document');
    expect(item!.attributes('disabled')).toBeDefined();
  });

  // The failed re-analysis banner is dismissible (issue #32): the stored
  // content stays readable with or without it.

  it('dismisses the failure banner while keeping the stored content', async () => {
    const wrapper = mount(ExtractionPanel, {
      props: { extraction: fixture, extractionState: 'failed' },
    });
    expect(wrapper.text()).toContain("Couldn't re-analyze");

    await wrapper.find('button[aria-label="Dismiss warning"]').trigger('click');
    expect(wrapper.text()).not.toContain("Couldn't re-analyze");
    expect(wrapper.text()).toContain(fixture.plainEnglishSummary);
  });

  it('re-shows the banner once a retried analysis fails again', async () => {
    const wrapper = mount(ExtractionPanel, {
      props: { extraction: fixture, extractionState: 'failed' },
    });
    await wrapper.find('button[aria-label="Dismiss warning"]').trigger('click');
    expect(wrapper.text()).not.toContain("Couldn't re-analyze");

    await wrapper.setProps({ extractionState: 'queued' });
    await wrapper.setProps({ extractionState: 'failed' });
    expect(wrapper.text()).toContain("Couldn't re-analyze");
  });
});

// Issue #77: the outline rail (prototype variant C2) — a slim icon rail on
// the panel's trailing edge, one button per section with count badges.
// Rendered only when the Host reports the lane presentation; the sheet and
// the pre-message state render without section navigation.
describe('ExtractionPanel outline rail (issue #77)', () => {
  const rail = (wrapper: ReturnType<typeof mount>) =>
    wrapper.find('nav[aria-label="Insights outline"]');
  const railButton = (wrapper: ReturnType<typeof mount>, label: string) =>
    rail(wrapper).findAll('button').find((b) => b.attributes('aria-label') === label);

  const ex = record({
    extractionStatus: 'COMPLETE',
    actionItems: [actionItem({ text: 'c1' }), actionItem({ text: 'c2' })],
    keyTakeaways: [takeaway({ text: 'n1' }), takeaway({ text: 'n2' }), takeaway({ text: 'n3' })],
  });

  it('renders no rail before the Host reports a presentation', () => {
    const wrapper = mount(ExtractionPanel, { props: { extraction: fixture } });
    expect(rail(wrapper).exists()).toBe(false);
  });

  it('renders no rail in the sheet presentation', () => {
    const wrapper = mount(ExtractionPanel, {
      props: { extraction: fixture, presentation: 'sheet' },
    });
    expect(rail(wrapper).exists()).toBe(false);
  });

  it('in the lane presentation, shows one button per section with count badges', () => {
    const wrapper = mount(ExtractionPanel, {
      props: { extraction: ex, presentation: 'lane' },
    });
    expect(rail(wrapper).exists()).toBe(true);
    const buttons = rail(wrapper).findAll('button');
    expect(buttons.map((b) => b.attributes('aria-label'))).toEqual([
      'Summary',
      'Needs your attention',
      'Key takeaways',
    ]);
    expect(railButton(wrapper, 'Summary')!.text()).toBe('');
    expect(railButton(wrapper, 'Needs your attention')!.text()).toBe('2');
    expect(railButton(wrapper, 'Key takeaways')!.text()).toBe('3');
  });

  it('tints the Critical Warnings badge with the warning color', () => {
    const wrapper = mount(ExtractionPanel, {
      props: { extraction: ex, presentation: 'lane' },
    });
    const badge = railButton(wrapper, 'Needs your attention')!.find('span');
    expect(badge.classes()).toContain('bg-kt-warning');
    expect(railButton(wrapper, 'Key takeaways')!.find('span').classes()).not.toContain(
      'bg-kt-warning',
    );
  });

  it('omits rail buttons for sections the Extraction does not render', () => {
    const calm = record({
      extractionStatus: 'COMPLETE',
      actionItems: [],
      keyTakeaways: [takeaway({ text: 'n1' })],
    });
    const wrapper = mount(ExtractionPanel, {
      props: { extraction: calm, presentation: 'lane' },
    });
    expect(railButton(wrapper, 'Needs your attention')).toBeUndefined();
    expect(railButton(wrapper, 'Key takeaways')).toBeDefined();
  });

  it('clicking a rail button scrolls the matching section into view', async () => {
    const scrollIntoView = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoView;
    try {
      const wrapper = mount(ExtractionPanel, {
        props: { extraction: ex, presentation: 'lane' },
      });
      await railButton(wrapper, 'Key takeaways')!.trigger('click');
      const section = wrapper.find('[data-section="takeaways"]');
      expect(scrollIntoView).toHaveBeenCalledOnce();
      expect(scrollIntoView.mock.contexts[0]).toBe(section.element);
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it('scroll-spy marks the section under the top edge as current', async () => {
    const scrollHeight = Object.getOwnPropertyDescriptor(
      document.documentElement,
      'scrollHeight',
    );
    Object.defineProperty(document.documentElement, 'scrollHeight', {
      configurable: true,
      value: 4000,
    });
    try {
      const wrapper = mount(ExtractionPanel, {
        props: { extraction: ex, presentation: 'lane' },
        attachTo: document.body,
      });
      const rect = (top: number) => ({ top }) as DOMRect;
      const sections = ['summary', 'attention', 'takeaways'].map(
        (id) => wrapper.find(`[data-section="${id}"]`).element as HTMLElement,
      );
      // Scroll until "Needs your attention" sits under the top edge.
      const tops = [-700, 20, 600];
      sections.forEach((s, i) =>
        vi.spyOn(s, 'getBoundingClientRect').mockReturnValue(rect(tops[i]!)),
      );
      window.dispatchEvent(new Event('scroll'));
      await wrapper.vm.$nextTick();

      expect(railButton(wrapper, 'Needs your attention')!.classes()).toContain(
        'text-kt-accent',
      );
      expect(railButton(wrapper, 'Summary')!.classes()).not.toContain('text-kt-accent');
      wrapper.unmount();
    } finally {
      if (scrollHeight) {
        Object.defineProperty(document.documentElement, 'scrollHeight', scrollHeight);
      }
    }
  });

  it('scroll-spy marks the last section while the panel is at the bottom', async () => {
    const scrollHeight = Object.getOwnPropertyDescriptor(
      document.documentElement,
      'scrollHeight',
    );
    const scrollY = Object.getOwnPropertyDescriptor(window, 'scrollY');
    Object.defineProperty(document.documentElement, 'scrollHeight', {
      configurable: true,
      value: 4000,
    });
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 3200 });
    try {
      const wrapper = mount(ExtractionPanel, {
        props: { extraction: ex, presentation: 'lane' },
      });
      window.dispatchEvent(new Event('scroll'));
      await wrapper.vm.$nextTick();
      expect(railButton(wrapper, 'Key takeaways')!.classes()).toContain('text-kt-accent');
      wrapper.unmount();
    } finally {
      if (scrollHeight) {
        Object.defineProperty(document.documentElement, 'scrollHeight', scrollHeight);
      }
      if (scrollY) Object.defineProperty(window, 'scrollY', scrollY);
    }
  });

  it('does not pin the last section when nothing scrolls', async () => {
    // scrollY 0 with a document that fits the frame: the bottom-edge rule
    // must not fire; the top-edge rule picks Summary.
    const wrapper = mount(ExtractionPanel, {
      props: { extraction: ex, presentation: 'lane' },
      attachTo: document.body,
    });
    const rect = (top: number) => ({ top }) as DOMRect;
    ['summary', 'attention', 'takeaways']
      .map((id) => wrapper.find(`[data-section="${id}"]`).element as HTMLElement)
      .forEach((s, i) =>
        vi.spyOn(s, 'getBoundingClientRect').mockReturnValue(rect([20, 600, 1200][i]!)),
      );
    window.dispatchEvent(new Event('scroll'));
    await wrapper.vm.$nextTick();
    expect(railButton(wrapper, 'Summary')!.classes()).toContain('text-kt-accent');
    wrapper.unmount();
  });
});

// Issue #79: the jump bar (prototype variant C2, mobile) — the outline rail
// as an HIG segmented control pinned at the top of the Guest's content so
// it stays visible and tappable at every sheet detent, including peek.
// Rendered only when the Host reports the sheet presentation; a tap scrolls
// the section and asks the Host to raise the sheet (GUEST_EXPAND_PANEL).
describe('ExtractionPanel jump bar (issue #79)', () => {
  const bar = (wrapper: ReturnType<typeof mount>) =>
    wrapper.find('nav[aria-label="Jump to section"]');
  const segment = (wrapper: ReturnType<typeof mount>, label: string) =>
    bar(wrapper)
      .findAll('button')
      .find((b) => b.text().includes(label));

  const ex = record({
    extractionStatus: 'COMPLETE',
    actionItems: [actionItem({ text: 'c1' }), actionItem({ text: 'c2' })],
    keyTakeaways: [takeaway({ text: 'n1' }), takeaway({ text: 'n2' }), takeaway({ text: 'n3' })],
  });

  it('renders no bar before the Host reports a presentation', () => {
    const wrapper = mount(ExtractionPanel, { props: { extraction: fixture } });
    expect(bar(wrapper).exists()).toBe(false);
  });

  it('renders no bar in the lane presentation', () => {
    const wrapper = mount(ExtractionPanel, {
      props: { extraction: fixture, presentation: 'lane' },
    });
    expect(bar(wrapper).exists()).toBe(false);
  });

  it('in the sheet presentation shows one segment per section, attention carrying the Critical Warning count', () => {
    const wrapper = mount(ExtractionPanel, {
      props: { extraction: ex, presentation: 'sheet' },
    });
    expect(bar(wrapper).exists()).toBe(true);
    expect(segment(wrapper, 'Summary')!.text()).toBe('Summary');
    expect(segment(wrapper, 'Attention')!.text()).toContain('Attention');
    expect(segment(wrapper, 'Attention')!.text()).toContain('2');
    expect(segment(wrapper, 'Takeaways')!.text()).toBe('Takeaways');
  });

  it('omits the attention segment when nothing is critical', () => {
    const calm = record({
      extractionStatus: 'COMPLETE',
      actionItems: [],
      keyTakeaways: [takeaway({ text: 'n1' })],
    });
    const wrapper = mount(ExtractionPanel, {
      props: { extraction: calm, presentation: 'sheet' },
    });
    expect(segment(wrapper, 'Attention')).toBeUndefined();
    expect(segment(wrapper, 'Takeaways')).toBeDefined();
  });

  it('tapping a segment scrolls its section and asks the Host to raise the sheet', async () => {
    const scrollIntoView = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoView;
    try {
      const wrapper = mount(ExtractionPanel, {
        props: { extraction: ex, presentation: 'sheet' },
      });
      await segment(wrapper, 'Takeaways')!.trigger('click');

      const section = wrapper.find('[data-section="takeaways"]');
      expect(scrollIntoView).toHaveBeenCalledOnce();
      expect(scrollIntoView.mock.contexts[0]).toBe(section.element);
      expect(wrapper.emitted('expandPanel')).toHaveLength(1);
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it('the rail tap never asks for a raise — the lane has no sheet', async () => {
    const scrollIntoView = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoView;
    try {
      const wrapper = mount(ExtractionPanel, {
        props: { extraction: ex, presentation: 'lane' },
      });
      await wrapper
        .find('nav[aria-label="Insights outline"]')
        .findAll('button')[0]!
        .trigger('click');
      expect(wrapper.emitted('expandPanel')).toBeUndefined();
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it('scroll-spy marks the segment under the jump bar as current', async () => {
    const scrollHeight = Object.getOwnPropertyDescriptor(
      document.documentElement,
      'scrollHeight',
    );
    Object.defineProperty(document.documentElement, 'scrollHeight', {
      configurable: true,
      value: 4000,
    });
    try {
      const wrapper = mount(ExtractionPanel, {
        props: { extraction: ex, presentation: 'sheet' },
        attachTo: document.body,
      });
      const rect = (top: number) => ({ top }) as DOMRect;
      ['summary', 'attention', 'takeaways']
        .map((id) => wrapper.find(`[data-section="${id}"]`).element as HTMLElement)
        .forEach((s, i) =>
          vi.spyOn(s, 'getBoundingClientRect').mockReturnValue(rect([-700, 50, 600][i]!)),
        );
      window.dispatchEvent(new Event('scroll'));
      await wrapper.vm.$nextTick();

      expect(segment(wrapper, 'Attention')!.attributes('aria-current')).toBe('location');
      expect(segment(wrapper, 'Summary')!.attributes('aria-current')).toBeUndefined();
      wrapper.unmount();
    } finally {
      if (scrollHeight) {
        Object.defineProperty(document.documentElement, 'scrollHeight', scrollHeight);
      }
    }
  });
});

// Issue #118: each Action Item carries a timing chip per kind, and a stored
// schemaVersion 1 Extraction gets a ⋯ menu note offering re-analysis for dates.
describe('ExtractionPanel timing chips and v1 note (issue #118)', () => {
  const rowFor = (timing: IdentifiedActionItem['timing']) =>
    mount(ExtractionPanel, {
      props: {
        extraction: record({
          extractionStatus: 'COMPLETE',
          actionItems: [actionItem({ text: 'do it', timing })],
          keyTakeaways: [],
        }),
      },
    }).find('[data-section="attention"] li');

  it('shows a due-date chip for FIXED_DATE', () => {
    const chip = rowFor({ kind: 'FIXED_DATE', dueDate: '2026-01-31' }).find('[data-timing-chip]');
    expect(chip.text()).toBe('Due 31 Jan 2026');
  });

  it('shows the schedule label for RECURRING', () => {
    const chip = rowFor({
      kind: 'RECURRING',
      cadence: 'MONTHLY',
      scheduleLabel: 'Monthly by the 3rd working day',
    }).find('[data-timing-chip]');
    expect(chip.text()).toBe('Monthly by the 3rd working day');
  });

  it('shows duration and anchor for NOTICE_PERIOD', () => {
    const chip = rowFor({
      kind: 'NOTICE_PERIOD',
      duration: 3,
      unit: 'MONTHS',
      anchor: 'moving out',
    }).find('[data-timing-chip]');
    expect(chip.text()).toBe('3 months’ notice · moving out');
  });

  it('uses the singular unit for a duration of one', () => {
    const chip = rowFor({
      kind: 'NOTICE_PERIOD',
      duration: 1,
      unit: 'WEEKS',
      anchor: 'contract end',
    }).find('[data-timing-chip]');
    expect(chip.text()).toBe('1 week’s notice · contract end');
  });

  it('shows no chip for NONE', () => {
    expect(rowFor({ kind: 'NONE' }).find('[data-timing-chip]').exists()).toBe(false);
  });

  it('shows no chip on Key Takeaway rows', () => {
    const wrapper = mount(ExtractionPanel, {
      props: {
        extraction: record({
          extractionStatus: 'COMPLETE',
          actionItems: [],
          keyTakeaways: [takeaway({ text: 'fact' })],
        }),
      },
    });
    expect(wrapper.find('[data-timing-chip]').exists()).toBe(false);
  });

  const openMenu = async (schemaVersion: 1 | 2) => {
    const wrapper = mount(ExtractionPanel, {
      props: { extraction: record({ extractionStatus: 'COMPLETE', schemaVersion }) },
    });
    await wrapper.find('button[aria-label="More actions"]').trigger('click');
    return wrapper;
  };

  it('notes in the ⋯ menu that a schemaVersion 1 Extraction is an earlier format', async () => {
    const wrapper = await openMenu(1);
    expect(wrapper.text()).toContain('Earlier analysis format — re-analyze for dates');
  });

  it('shows no earlier-format note for schemaVersion 2', async () => {
    const wrapper = await openMenu(2);
    expect(wrapper.text()).not.toContain('Earlier analysis format');
  });
});
