import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { goldenFixtureMessages } from '@klartext/bus-contract';
import type { ExtractionRecord, KeyTakeaway } from '@klartext/bus-contract';
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
  return { text: 'x', importance: 'NORMAL', sourceQuote: 'q', ...partial };
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
      keyTakeaways: [
        takeaway({ text: 'a', importance: 'CRITICAL' }),
        takeaway({ text: 'b' }),
        takeaway({ text: 'c', importance: 'CRITICAL' }),
      ],
    });
    const wrapper = mount(ExtractionPanel, { props: { extraction: two } });
    expect(attentionButton(wrapper)?.text()).toContain('2 things need your attention');
  });

  it('omits the attention callout when nothing is critical', () => {
    const calm = record({
      extractionStatus: 'COMPLETE',
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

  // Grouped-list rows: one per Key Takeaway — a number stable across both
  // sections (the takeaway's place in the Extraction), the plain-English
  // text, and a trailing page label when the Extraction located one.

  it('numbers rows by their place in the Extraction across both sections', () => {
    const ex = record({
      extractionStatus: 'COMPLETE',
      keyTakeaways: [
        takeaway({ text: 'first normal', page: 1 }),
        takeaway({ text: 'critical mid', importance: 'CRITICAL', page: 2 }),
        takeaway({ text: 'last normal', page: 4 }),
      ],
    });
    const wrapper = mount(ExtractionPanel, { props: { extraction: ex } });

    const attention = wrapper.find('[data-section="attention"]');
    expect(attention.text()).toContain('critical mid');
    expect(attention.findAll('li')).toHaveLength(1);
    expect(attention.find('li').text()).toContain('2');
    expect(attention.find('li').text()).toContain('p. 2');

    const takeaways = wrapper.find('[data-section="takeaways"]');
    const rows = takeaways.findAll('li');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.text()).toContain('1');
    expect(rows[0]!.text()).toContain('first normal');
    expect(rows[0]!.text()).toContain('p. 1');
    expect(rows[1]!.text()).toContain('3');
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
      keyTakeaways: [
        takeaway({
          text: 'deadline',
          sourceQuote: 'Frist drei Monate',
          importance: 'CRITICAL',
          page: 3,
        }),
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
          extraction: record({ extractionStatus, statusExplanation: 'x', keyTakeaways: [] }),
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
    keyTakeaways: [
      takeaway({ text: 'c1', importance: 'CRITICAL' }),
      takeaway({ text: 'n1' }),
      takeaway({ text: 'c2', importance: 'CRITICAL' }),
      takeaway({ text: 'n2' }),
      takeaway({ text: 'n3' }),
    ],
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
