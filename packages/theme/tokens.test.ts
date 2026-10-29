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
  '--kt-danger-text', '--kt-warning-text',
  '--kt-font-sans', '--kt-font-mono',
  '--kt-text-xs', '--kt-text-sm', '--kt-text-base', '--kt-text-lg', '--kt-text-xl', '--kt-text-2xl', '--kt-text-3xl',
  '--kt-space-1', '--kt-space-2', '--kt-space-3', '--kt-space-4', '--kt-space-5', '--kt-space-6', '--kt-space-8',
  '--kt-radius-sm', '--kt-radius-md', '--kt-radius-lg', '--kt-radius-xl',
  '--kt-shadow-panel', '--kt-shadow-raised', '--kt-shadow-popover',
  '--kt-sidebar-width', '--kt-list-width', '--kt-insights-width',
  '--kt-toolbar-height', '--kt-control-height', '--kt-touch-target',
  '--kt-sheet-peek-height',
  // Overlay surfaces (issue #149, ADR 0014): the named stacking scale plus
  // the shared sheet/grabber/backdrop chrome.
  '--kt-z-chrome', '--kt-z-sheet', '--kt-z-menu-shield', '--kt-z-menu',
  '--kt-z-backdrop', '--kt-z-modal', '--kt-z-modal-alert', '--kt-z-toast',
  '--kt-sheet-radius', '--kt-backdrop', '--kt-modal-margin',
  '--kt-grabber-width', '--kt-grabber-height', '--kt-grabber-radius', '--kt-grabber-color',
];

const SPEC_VALUES: Record<string, string> = {
  '--kt-accent': '#007aff',
  '--kt-warning': '#ff9500',
  '--kt-danger': '#ff3b30',
  '--kt-success': '#34c759',
  // AA-contrast Urgency text shades (ADR 0012); the bright tokens stay for shapes.
  '--kt-danger-text': '#d70015',
  '--kt-warning-text': '#b35c00',
  '--kt-space-1': '4px',
  '--kt-control-height': '36px',
  '--kt-touch-target': '44px',
  // The stacking scale keeps today's order (issue #149); the alert rung is
  // new — one level above a modal for "Discard changes?" over a dialog.
  '--kt-z-chrome': '15',
  '--kt-z-sheet': '20',
  '--kt-z-menu-shield': '39',
  '--kt-z-menu': '40',
  '--kt-z-backdrop': '80',
  '--kt-z-modal': '81',
  '--kt-z-modal-alert': '82',
  '--kt-z-toast': '90',
  // The grabber pill: 36×5, fully rounded, fill-strong like the Guest
  // frame's handle.
  '--kt-grabber-width': '36px',
  '--kt-grabber-height': '5px',
  '--kt-grabber-radius': '999px',
  '--kt-grabber-color': 'var(--kt-fill-strong)',
  '--kt-backdrop': 'rgba(0, 0, 0, 0.25)',
};

const TEXT_TOKENS = [
  '--kt-text-xs',
  '--kt-text-sm',
  '--kt-text-base',
  '--kt-text-lg',
  '--kt-text-xl',
  '--kt-text-2xl',
  '--kt-text-3xl',
];

describe('theme tokens', () => {
  it.each(TOKENS)('defines %s', (token) => {
    expect(css).toContain(`${token}:`);
  });

  it.each(Object.entries(SPEC_VALUES))('pins %s to its spec value %s', (token, value) => {
    expect(css).toMatch(new RegExp(`${token.replaceAll('-', '\\-')}:\\s*${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*;`));
  });

  it.each(TEXT_TOKENS)('keeps %s at or above the 12px (0.75rem) accessibility floor', (token) => {
    const match = css.match(new RegExp(`${token.replaceAll('-', '\\-')}:\\s*([0-9.]+)rem\\s*;`));
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBeGreaterThanOrEqual(0.75);
  });
});
