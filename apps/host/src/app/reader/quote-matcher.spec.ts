import { describe, expect, it } from 'vitest';
import { findQuote } from './quote-matcher';

// Issue #80: the matcher locates a Key Takeaway's `sourceQuote` inside a
// page's pdf.js text items — tolerant of collapsed whitespace, line breaks
// (item boundaries), hyphenation, typographic quotes/dashes, and
// ellipsis-shortened quotes. It answers per-item char spans, or null when
// the page doesn't carry the quote (the caller falls back to the flash).
describe('findQuote', () => {
  it('finds a quote inside a single item', () => {
    expect(findQuote(['hello brave new world'], 'brave new')).toEqual([
      { item: 0, start: 6, end: 15 },
    ]);
  });

  it('collapses whitespace runs in the page text', () => {
    expect(findQuote(['Die  Miete   ist'], 'Die Miete ist')).toEqual([
      { item: 0, start: 0, end: 16 },
    ]);
  });

  it('matches across a line break — items join without a space', () => {
    // pdf.js splits lines into items; "drei" ends one, "Monate." starts the
    // next, with no whitespace item between them.
    const items = ['Die Kündigungsfrist beträgt drei', 'Monate.'];
    expect(findQuote(items, 'beträgt drei Monate.')).toEqual([
      { item: 0, start: 20, end: 32 },
      { item: 1, start: 0, end: 7 },
    ]);
  });

  it('matches across a hyphenated line break', () => {
    const items = ['Die Kündi-', 'gungsfrist beträgt drei Monate.'];
    expect(findQuote(items, 'Kündigungsfrist')).toEqual([
      { item: 0, start: 4, end: 10 },
      { item: 1, start: 0, end: 10 },
    ]);
  });

  it('ignores soft hyphens left in the text', () => {
    expect(findQuote(['Kündi\u00ADgungsfrist beträgt'], 'Kündigungsfrist')).toEqual([
      { item: 0, start: 0, end: 16 },
    ]);
  });

  it('folds typographic quotes and dashes to their ASCII reading', () => {
    expect(findQuote(['genannt — nachfolgend »Vermieterin«'], '- nachfolgend "Vermieterin"')).toEqual(
      [{ item: 0, start: 8, end: 35 }],
    );
  });

  it('matches an ellipsis-shortened quote by its parts', () => {
    const items = [
      'Die Kündigung bedarf der Schriftform. Die Kündigungsfrist beträgt drei',
      'Monate.',
    ];
    expect(findQuote(items, 'Die Kündigung … drei Monate.')).toEqual([
      { item: 0, start: 0, end: 70 },
      { item: 1, start: 0, end: 7 },
    ]);
  });

  it('matches a quote ending in an ellipsis by its head alone', () => {
    expect(findQuote(['Berlin, den 15. März 2024'], 'Berlin, den 15…')).toEqual([
      { item: 0, start: 0, end: 14 },
    ]);
  });

  it('returns null when the page does not carry the quote', () => {
    expect(findQuote(['Etwas ganz anderes'], 'nicht vorhanden')).toBeNull();
  });

  it('returns null for an empty quote', () => {
    expect(findQuote(['text'], '   ')).toBeNull();
  });
});
