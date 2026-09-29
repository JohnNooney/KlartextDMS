import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { goldenFixtureMessages } from '@klartext/bus-contract';
import type { ExtractionState, Session } from '@klartext/bus-contract';
import App from './App.vue';
import { currentSession, retrySender, sessionProbe } from './session-store';

const fixtureSession = goldenFixtureMessages.INIT_SESSION.payload;

function session(
  extractionState: ExtractionState,
  extraction: Session['extraction'] = null,
): Session {
  return { ...fixtureSession, extraction, extractionState };
}

beforeEach(() => {
  currentSession.value = null;
  retrySender.value = null;
});

describe('App', () => {
  it("renders the Guest's pre-Session empty state", () => {
    const wrapper = mount(App);
    expect(wrapper.text()).toContain('Klartext');
    expect(wrapper.text()).toContain('Open a document');
  });

  it('renders the Extraction once a Session is applied', () => {
    sessionProbe.sessionApplied(fixtureSession);
    const wrapper = mount(App);
    expect(wrapper.text()).toContain(fixtureSession.documentTitle);
    expect(wrapper.text()).toContain(fixtureSession.extraction!.plainEnglishSummary);
  });

  it('renders the fixture panel in standalone dev', () => {
    sessionProbe.sessionApplied(fixtureSession);
    const wrapper = mount(App);
    expect(wrapper.text()).toContain('Needs your attention');
  });

  // The Session state matrix (issue #15): no Extraction × each job state.

  it('no Extraction + none offers "Analyze document" which sends RETRY_EXTRACTION', async () => {
    const retry = vi.fn();
    retrySender.value = retry;
    sessionProbe.sessionApplied(session('none'));
    const wrapper = mount(App);
    const button = wrapper.findAll('button').find((b) => b.text() === 'Analyze document');
    expect(button).toBeDefined();
    await button!.trigger('click');
    expect(retry).toHaveBeenCalledWith(fixtureSession.documentId);
  });

  it.each([
    ['queued', 'Waiting to analyze'],
    ['running', 'Analyzing'],
  ] as const)('no Extraction + %s shows "%s"', (state, copy) => {
    sessionProbe.sessionApplied(session(state));
    const wrapper = mount(App);
    expect(wrapper.text()).toContain(copy);
    expect(wrapper.text()).not.toContain('Needs your attention');
    expect(wrapper.findAll('button')).toHaveLength(0);
  });

  it('no Extraction + failed shows the error and "Try again" sends RETRY_EXTRACTION', async () => {
    const retry = vi.fn();
    retrySender.value = retry;
    sessionProbe.sessionApplied(session('failed'));
    const wrapper = mount(App);
    expect(wrapper.text()).toContain('Extraction failed');
    const button = wrapper.findAll('button').find((b) => b.text() === 'Try again');
    expect(button).toBeDefined();
    await button!.trigger('click');
    expect(retry).toHaveBeenCalledWith(fixtureSession.documentId);
  });

  // Extraction present × each job state: stored content stays, plus the indicator.

  it.each([
    ['queued', 'Re-analysis queued'],
    ['running', 'Re-analyzing'],
  ] as const)('Extraction + %s keeps the stored content and shows "%s"', (state, copy) => {
    sessionProbe.sessionApplied(session(state, fixtureSession.extraction));
    const wrapper = mount(App);
    expect(wrapper.text()).toContain(fixtureSession.extraction!.plainEnglishSummary);
    expect(wrapper.text()).toContain(copy);
  });

  it('Extraction + failed keeps the stored content under a warning banner with Try again', async () => {
    const retry = vi.fn();
    retrySender.value = retry;
    sessionProbe.sessionApplied(session('failed', fixtureSession.extraction));
    const wrapper = mount(App);
    expect(wrapper.text()).toContain(fixtureSession.extraction!.plainEnglishSummary);
    expect(wrapper.text()).toContain("Couldn't re-analyze");
    const button = wrapper.findAll('button').find((b) => b.text() === 'Try again');
    expect(button).toBeDefined();
    await button!.trigger('click');
    expect(retry).toHaveBeenCalledWith(fixtureSession.documentId);
  });
});
