/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{vue,js}'],
  theme: {
    extend: {
      colors: {
        'kt-bg': 'var(--kt-bg)',
        'kt-surface': 'var(--kt-surface)',
        'kt-surface-raised': 'var(--kt-surface-raised)',
        'kt-text': 'var(--kt-text)',
        'kt-text-muted': 'var(--kt-text-muted)',
        'kt-border': 'var(--kt-border)',
        'kt-accent': 'var(--kt-accent)',
        'kt-accent-dim': 'var(--kt-accent-dim)',
        'kt-success': 'var(--kt-success)',
        'kt-warning': 'var(--kt-warning)',
        'kt-danger': 'var(--kt-danger)',
      },
      fontFamily: {
        sans: 'var(--kt-font-sans)',
        mono: 'var(--kt-font-mono)',
      },
      spacing: {
        18: '4.5rem',
      },
      borderRadius: {
        'kt-sm': 'var(--kt-radius-sm)',
        'kt-md': 'var(--kt-radius-md)',
        'kt-lg': 'var(--kt-radius-lg)',
      },
    },
  },
  plugins: [],
};
