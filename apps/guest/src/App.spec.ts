import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import App from './App.vue';

describe('App', () => {
  it("renders the Guest's pre-Session empty state", () => {
    const wrapper = mount(App);
    expect(wrapper.text()).toContain('Klartext');
    expect(wrapper.text()).toContain('Open a document');
  });
});
