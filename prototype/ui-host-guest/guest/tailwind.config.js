import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('tailwindcss').Config} */
export default {
  content: [path.resolve(__dirname, 'index.html'), path.resolve(__dirname, 'src/**/*.{vue,js}')],
  theme: {
    extend: {
      colors: {
        'kt-canvas': 'var(--kt-canvas)',
        'kt-bg': 'var(--kt-bg)',
        'kt-surface': 'var(--kt-surface)',
        'kt-fill': 'var(--kt-fill)',
        'kt-fill-strong': 'var(--kt-fill-strong)',
        'kt-text': 'var(--kt-text)',
        'kt-text-muted': 'var(--kt-text-muted)',
        'kt-text-faint': 'var(--kt-text-faint)',
        'kt-border': 'var(--kt-border)',
        'kt-accent': 'var(--kt-accent)',
        'kt-accent-tint': 'var(--kt-accent-tint)',
        'kt-success': 'var(--kt-success)',
        'kt-warning': 'var(--kt-warning)',
        'kt-warning-tint': 'var(--kt-warning-tint)',
        'kt-danger': 'var(--kt-danger)',
        'kt-danger-tint': 'var(--kt-danger-tint)',
      },
      fontFamily: { sans: 'var(--kt-font-sans)', mono: 'var(--kt-font-mono)' },
      borderRadius: { 'kt-sm': 'var(--kt-radius-sm)', 'kt-md': 'var(--kt-radius-md)', 'kt-lg': 'var(--kt-radius-lg)' },
    },
  },
  plugins: [],
};
