import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import { goldenFixtureMessages } from '@klartext/bus-contract';
import type { Session } from '@klartext/bus-contract';
import App from './App.vue';
import { currentSession, sessionProbe } from './session-store';

const fixtureSession = goldenFixtureMessages.INIT_SESSION.payload;

beforeEach(() => {
  currentSession.value = null;
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

  it('shows the in-progress state for a Session without an Extraction', () => {
    const running: Session = {
      ...fixtureSession,
      extraction: null,
      extractionState: 'running',
    };
    sessionProbe.sessionApplied(running);
    const wrapper = mount(App);
    expect(wrapper.text()).toContain('Extraction in progress');
    expect(wrapper.text()).not.toContain('Needs your attention');
  });

  it('shows a failed Extraction state', () => {
    const failed: Session = {
      ...fixtureSession,
      extraction: null,
      extractionState: 'failed',
    };
    sessionProbe.sessionApplied(failed);
    const wrapper = mount(App);
    expect(wrapper.text()).toContain('Extraction failed');
  });
});
