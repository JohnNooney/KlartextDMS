/**
 * Regenerates the Host's browser icons in apps/host/public/ (issue #94). They
 * redraw the in-app K mark — .brand-mark in app.html / sign-in-gate.html, a
 * bold system-font "K" on --kt-accent — as a hand-outlined path, so every
 * rendering is font-independent. Keep ACCENT in step with packages/theme/tokens.css.
 *
 *   icon.svg              rounded square, transparent corners (tab favicon)
 *   favicon.ico           16/32 PNGs of icon.svg (legacy fallback)
 *   apple-touch-icon.png  180, full-bleed (iOS applies its own mask)
 *   icon-192/512.png      full-bleed, maskable (glyph inside the 80% safe zone)
 *
 * Dependency-free beyond the Playwright Chromium the e2e workspace already
 * installs. Re-run `node scripts/generate-icons.mjs` after changing the mark.
 */
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const { chromium } = createRequire(new URL('../e2e/package.json', import.meta.url))('@playwright/test');

const ACCENT = '#007aff';
const K = 'M146 128H200V244L304 128H370L263 244L376 384H308L226 280L200 308V384H146Z';

const svg = ({ rounded }) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">` +
  `<rect width="512" height="512"${rounded ? ' rx="138"' : ''} fill="${ACCENT}"/>` +
  `<path d="${K}" fill="#fff"/></svg>\n`;

const out = (name) => new URL(`../apps/host/public/${name}`, import.meta.url);

const browser = await chromium.launch();
const page = await browser.newPage();
const render = async (markup, size) => {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${markup}`,
  );
  return page.screenshot({ omitBackground: true });
};

// ICO container holding PNG-encoded images (supported by every current browser).
const ico = (pngs) => {
  const header = Buffer.alloc(6 + 16 * pngs.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach(({ size, data }, i) => {
    const entry = 6 + 16 * i;
    header.writeUInt8(size % 256, entry);
    header.writeUInt8(size % 256, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(data.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...pngs.map((p) => p.data)]);
};

const rounded = svg({ rounded: true });
const fullBleed = svg({ rounded: false });

writeFileSync(out('icon.svg'), rounded);
const icoPngs = [];
for (const size of [16, 32]) icoPngs.push({ size, data: await render(rounded, size) });
writeFileSync(out('favicon.ico'), ico(icoPngs));
writeFileSync(out('apple-touch-icon.png'), await render(fullBleed, 180));
for (const size of [192, 512]) writeFileSync(out(`icon-${size}.png`), await render(fullBleed, size));

await browser.close();
console.log('Icons written to apps/host/public/');
