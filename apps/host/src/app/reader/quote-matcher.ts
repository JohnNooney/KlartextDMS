/**
 * The quote matcher (issue #80): locates a Key Takeaway's `sourceQuote`
 * inside a page's pdf.js text items, tolerant of real-world PDF text —
 * collapsed whitespace and line breaks (item boundaries join without a
 * space), hyphenation across lines, typographic quotes/dashes, and
 * ellipsis-shortened quotes (`…`/`...` splits the quote into parts matched
 * in order). Answers the per-item char spans to highlight, or `null` when
 * the page doesn't carry the quote — the caller falls back to the flash.
 */

/** A matched `[start, end)` char range inside one text item. */
export interface QuoteMatchSpan {
  /** Index into the item array (aligned with the text layer's divs). */
  item: number;
  start: number;
  end: number;
}

// Typographic characters folded to their ASCII reading — the Extraction's
// quote and the PDF's text may carry either form.
const FOLD: Record<string, string> = {
  '‘': "'", '’': "'", '‚': "'", '‛': "'", '′': "'",
  '“': '"', '”': '"', '„': '"', '‟': '"', '«': '"', '»': '"', '″': '"',
  '‐': '-', '‑': '-', '‒': '-', '–': '-', '—': '-', '―': '-', '−': '-', '⁃': '-',
};

const SOFT_HYPHEN = '\u00AD';
/** Optional "- line-break" after a quote char: hyphenation across lines. */
const HYPHEN_GAP = '(?:[-\\u00AD\\u2010-\\u2015\\u2043]\\s*)?';
/**
 * The gap an ellipsis stands for — the elided middle, matched lazily and
 * bounded: past ~500 chars a wild match is likelier than a dropped
 * paragraph, and a miss just falls back to the page flash.
 */
const ELISION_GAP = '[\\s\\S]{0,500}?';

interface NormalizedText {
  text: string;
  /** The item index owning each normalized char. */
  items: number[];
  /** The owning char's offset inside its item. */
  offsets: number[];
}

/**
 * Folds `items` into one normalized string plus per-char ownership. NFKC
 * first (ligatures, `…` → `...`), then the FOLD table; whitespace runs
 * collapse to one space, soft hyphens evaporate.
 */
function normalizeItems(items: readonly string[]): NormalizedText {
  const text: string[] = [];
  const itemIdx: number[] = [];
  const charIdx: number[] = [];
  let ws: { item: number; offset: number } | null = null;

  items.forEach((str, i) => {
    for (let offset = 0; offset < str.length; offset++) {
      for (const c of str[offset]!.normalize('NFKC')) {
        for (const m of FOLD[c] ?? c) {
          if (m === SOFT_HYPHEN) continue;
          if (/\s/.test(m)) {
            ws ??= { item: i, offset };
            continue;
          }
          // The run's first whitespace char stands in for the whole run —
          // a space carries no glyph, so any stand-in highlights the same.
          if (ws && text.length > 0) {
            text.push(' ');
            itemIdx.push(ws.item);
            charIdx.push(ws.offset);
          }
          ws = null;
          text.push(m);
          itemIdx.push(i);
          charIdx.push(offset);
        }
      }
    }
  });
  return { text: text.join(''), items: itemIdx, offsets: charIdx };
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The quote as a match pattern: each part of an ellipsis-split quote in
 * order, its whitespace matching zero-or-more page whitespace (a line
 * break may carry no space item), each char tolerating a trailing
 * hyphenation break.
 */
function quotePattern(quote: string): RegExp | null {
  const parts = normalizeItems([quote])
    .text.split(/\.{3,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  const frag = (part: string) =>
    [...part].map((c) => (c === ' ' ? '\\s*' : escapeRe(c) + HYPHEN_GAP)).join('');
  return new RegExp(parts.map(frag).join(ELISION_GAP), 'u');
}

export function findQuote(items: readonly string[], quote: string): QuoteMatchSpan[] | null {
  if (!quote.trim()) return null;
  const pattern = quotePattern(quote);
  if (!pattern) return null;
  const hay = normalizeItems(items);
  const match = pattern.exec(hay.text);
  if (!match) return null;

  // Per-item spans coalesce to min..max — two disjoint matches inside one
  // item (e.g. an ellipsis-split quote) tint the text between them too.
  const covered = new Map<number, { start: number; end: number }>();
  for (let i = match.index; i < match.index + match[0].length; i++) {
    const span = covered.get(hay.items[i]!);
    const offset = hay.offsets[i]!;
    if (!span) covered.set(hay.items[i]!, { start: offset, end: offset + 1 });
    else {
      span.start = Math.min(span.start, offset);
      span.end = Math.max(span.end, offset + 1);
    }
  }
  return [...covered.entries()]
    .sort(([a], [b]) => a - b)
    .map(([item, span]) => ({ item, ...span }));
}

/**
 * Wraps each matched range in a `pdf-hit` tint span inside its text-layer
 * div (`--critical` selects the warning tint). Answers the first wrap, for
 * the caller's scroll-into-view, or `null` when nothing landed in the DOM.
 */
export function wrapMatch(
  divs: readonly HTMLElement[],
  spans: readonly QuoteMatchSpan[],
  critical: boolean,
): HTMLElement | null {
  let first: HTMLElement | null = null;
  for (const { item, start, end } of spans) {
    const div = divs[item];
    const text = div?.textContent ?? '';
    const last = Math.min(end, text.length);
    if (!div || last <= start) continue;
    const hit = document.createElement('span');
    hit.className = critical ? 'pdf-hit pdf-hit--critical' : 'pdf-hit';
    hit.textContent = text.slice(start, last);
    div.replaceChildren(
      document.createTextNode(text.slice(0, start)),
      hit,
      document.createTextNode(text.slice(last)),
    );
    first ??= hit;
  }
  return first;
}
