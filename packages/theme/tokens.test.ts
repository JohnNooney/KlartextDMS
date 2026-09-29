import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Contract: the token set settled by the UI prototype (issue #12) — Apple system
// colors, fill/separator tints, 4-pt spacing, SF type scale, 32 px controls /
// 44 px touch targets. Values below come from the spec, not from the CSS.
const css = readFileSync(fileURLToPath(new URL('./tokens.css', import.meta.url)), 'utf8');

const TOKENS = [
  '--kt-canvas', '--kt-bg', '--kt-surface', '--kt-fill', '--kt-fill-strong',
  '--kt-text', '--kt-text-muted', '--kt-text-faint',
  '--kt-border', '--kt-border-strong',
  '--kt-accent', '--kt-accent-hover', '--kt-accent-tint',
  '--kt-success', '--kt-warning', '--kt-warning-tint',
  '--kt-danger', '--kt-danger-tint', '--kt-folder',
  '--kt-font-sans', '--kt-font-mono',
  '--kt-text-xs', '--kt-text-sm', '--kt-text-base', '--kt-text-lg', '--kt-text-xl', '--kt-text-2xl', '--kt-text-3xl',
  '--kt-space-1', '--kt-space-2', '--kt-space-3', '--kt-space-4', '--kt-space-5', '--kt-space-6', '--kt-space-8',
  '--kt-radius-sm', '--kt-radius-md', '--kt-radius-lg', '--kt-radius-xl',
  '--kt-shadow-panel', '--kt-shadow-raised', '--kt-shadow-popover',
  '--kt-sidebar-width', '--kt-list-width', '--kt-insights-width',
  '--kt-toolbar-height', '--kt-control-height', '--kt-touch-target',
  '--kt-sheet-peek-height',
];

const SPEC_VALUES: Record<string, string> = {
  '--kt-accent': '#007aff',
  '--kt-warning': '#ff9500',
  '--kt-danger': '#ff3b30',
  '--kt-success': '#34c759',
  '--kt-space-1': '4px',
  '--kt-control-height': '32px',
  '--kt-touch-target': '44px',
};

describe('theme tokens', () => {
  it.each(TOKENS)('defines %s', (token) => {
    expect(css).toContain(`${token}:`);
  });

  it.each(Object.entries(SPEC_VALUES))('pins %s to its spec value %s', (token, value) => {
    expect(css).toMatch(new RegExp(`${token.replaceAll('-', '\\-')}:\\s*${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*;`));
  });
});
