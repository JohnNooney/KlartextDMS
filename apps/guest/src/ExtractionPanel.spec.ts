import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { goldenFixtureMessages } from '@klartext/bus-contract';
import type { ExtractionRecord } from '@klartext/bus-contract';
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

describe('ExtractionPanel', () => {
  it('renders the document-type label, provenance, and summary', () => {
    const wrapper = mount(ExtractionPanel, {
      props: { extraction: fixture, documentTitle: 'Mietvertrag 2024.pdf' },
    });
    expect(wrapper.text()).toContain('Tenancy agreement');
    expect(wrapper.text()).toContain('Translated from German');
    expect(wrapper.text()).toContain('Analyzed');
    expect(wrapper.text()).toContain('gemini-2.5-flash');
    expect(wrapper.text()).toContain(fixture.plainEnglishSummary);
  });

  it('uses documentTypeLabel for OTHER Extractions', () => {
    const wrapper = mount(ExtractionPanel, {
      props: { extraction: record({}), documentTitle: 'Nebenkosten.pdf' },
    });
    expect(wrapper.text()).toContain('Service charge statement');
  });

  it('surfaces CRITICAL Key Takeaways under "Needs your attention" with their source quotes', () => {
    const wrapper = mount(ExtractionPanel, {
      props: { extraction: fixture, documentTitle: 'Mietvertrag 2024.pdf' },
    });
    const critical = fixture.keyTakeaways.find((t) => t.importance === 'CRITICAL')!;
    expect(wrapper.text()).toContain('Needs your attention');
    expect(wrapper.text()).toContain(critical.text);
    expect(wrapper.text()).toContain(critical.sourceQuote);
  });

  it('renders NORMAL Key Takeaways after the critical cards', () => {
    const wrapper = mount(ExtractionPanel, {
      props: { extraction: fixture, documentTitle: 'Mietvertrag 2024.pdf' },
    });
    const normal = fixture.keyTakeaways.find((t) => t.importance === 'NORMAL')!;
    const text = wrapper.text();
    expect(text).toContain(normal.text);
    expect(text.indexOf('Needs your attention')).toBeLessThan(text.indexOf(normal.text));
  });

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
          documentTitle: 'scan.pdf',
        },
      });
      expect(wrapper.text()).toContain('Not enough readable text');
      expect(wrapper.text()).not.toContain('Needs your attention');
    },
  );

  // Explicit re-run (issue #15): ⋯ → "Re-analyze document" — hidden on
  // non-COMPLETE statuses, disabled while a job is queued/running.

  it('offers "Re-analyze document" from the header menu and emits reanalyze', async () => {
    const wrapper = mount(ExtractionPanel, {
      props: { extraction: fixture, documentTitle: 'Mietvertrag 2024.pdf' },
    });
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
          documentTitle: 'scan.pdf',
        },
      });
      expect(wrapper.find('button[aria-label="More actions"]').exists()).toBe(false);
    },
  );

  it.each(['queued', 'running'] as const)('disables re-analyze while %s', async (state) => {
    const wrapper = mount(ExtractionPanel, {
      props: { extraction: fixture, documentTitle: 'x.pdf', extractionState: state },
    });
    await wrapper.find('button[aria-label="More actions"]').trigger('click');
    const item = wrapper.findAll('button').find((b) => b.text() === 'Re-analyze document');
    expect(item!.attributes('disabled')).toBeDefined();
  });

  // The failed re-analysis banner is dismissible (issue #32): the stored
  // content stays readable with or without it.

  it('dismisses the failure banner while keeping the stored content', async () => {
    const wrapper = mount(ExtractionPanel, {
      props: { extraction: fixture, documentTitle: 'Mietvertrag 2024.pdf', extractionState: 'failed' },
    });
    expect(wrapper.text()).toContain("Couldn't re-analyze");

    await wrapper.find('button[aria-label="Dismiss warning"]').trigger('click');
    expect(wrapper.text()).not.toContain("Couldn't re-analyze");
    expect(wrapper.text()).toContain(fixture.plainEnglishSummary);
  });

  it('re-shows the banner once a retried analysis fails again', async () => {
    const wrapper = mount(ExtractionPanel, {
      props: { extraction: fixture, documentTitle: 'Mietvertrag 2024.pdf', extractionState: 'failed' },
    });
    await wrapper.find('button[aria-label="Dismiss warning"]').trigger('click');
    expect(wrapper.text()).not.toContain("Couldn't re-analyze");

    await wrapper.setProps({ extractionState: 'queued' });
    await wrapper.setProps({ extractionState: 'failed' });
    expect(wrapper.text()).toContain("Couldn't re-analyze");
  });
});
