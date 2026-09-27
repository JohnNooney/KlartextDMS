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
});
