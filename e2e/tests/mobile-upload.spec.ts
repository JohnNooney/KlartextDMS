import { devices, expect, test } from '@playwright/test';
import {
  browseRoot,
  expectInsideViewport,
  expectNoHorizontalOverflow,
  seededPdf,
  signedInPage,
  tile,
  toast,
  unique,
  uploadViaDialog,
} from './support';

// Journey (issue #48): while an upload is in flight on a phone-width
// viewport, the Document row stays inside the screen — thumbnail, title,
// progress bar, and ⋮ all fit, and the page never side-scrolls.
const page = signedInPage({ ...devices['iPhone 13'] });

// Resumable uploads move in 256 KB POST chunks (`upload_protocol=resumable`),
// so padding the fixture past one chunk lets the first land and gates the
// rest — the upload hangs mid-flight at a real percent for the row check.
// Released in afterEach so a failed assertion never leaves the route gated.
const storageCalls = '**/v0/b/**';
let releaseBytes: () => void = () => {};
let secondChunkSeen: () => void = () => {};

test('an in-flight upload row fits the viewport — progress, title, ⋮', async () => {
  await browseRoot(page());

  const gate = new Promise<void>((resolve) => (releaseBytes = resolve));
  const secondChunk = new Promise<void>((resolve) => (secondChunkSeen = resolve));
  let chunks = 0;
  await page().route(storageCalls, async (route) => {
    const isChunk =
      route.request().method() === 'POST' &&
      route.request().url().includes('upload_protocol=resumable');
    if (!isChunk || ++chunks < 2) {
      await route.fallback();
      return;
    }
    secondChunkSeen();
    await gate;
    await route.fallback().catch(() => {});
  });

  // Long enough to need an ellipsis and a second upload chunk.
  const title = unique('Einkommensteuerbescheid Nachzahlungsfrist');
  const bytes = Buffer.concat([seededPdf('mietvertrag-2024.pdf'), Buffer.alloc(700 * 1024)]);
  await uploadViaDialog(page(), [{ name: `${title}.pdf`, buffer: bytes }]);

  const row = tile(page(), title);
  const progress = row.getByRole('progressbar', { name: 'Upload progress' });
  await row.scrollIntoViewIfNeeded();
  await expect(progress).toBeVisible();
  // The first chunk has landed — the bar reports a real in-between percent
  // (not 0, not done) and its fill tracks that number.
  await secondChunk;
  await expect
    .poll(async () => Number(await progress.getAttribute('aria-valuenow')))
    .toBeGreaterThan(0);
  const pct = Number(await progress.getAttribute('aria-valuenow'));
  expect(pct).toBeLessThan(100);
  expect(await progress.locator('span').evaluate((el) => el.style.width)).toBe(`${pct}%`);

  // Thumbnail, title, progress bar, and ⋮ all sit inside the screen edge —
  // and the ⋮ still opens its menu.
  await expectInsideViewport(page(), row.locator('.tile-thumb'));
  await expectInsideViewport(page(), row.locator('.tile-name'));
  await expectInsideViewport(page(), progress);
  const more = page().getByRole('button', { name: `More actions for ${title}`, exact: true });
  await expectInsideViewport(page(), more);
  await expectNoHorizontalOverflow(page());
  await more.tap();
  await expect(page().getByRole('menuitem', { name: 'Cancel upload' })).toBeVisible();
  await page().keyboard.press('Escape');
  await expectNoHorizontalOverflow(page());

  // Releasing the gate lets the bytes finish — the row settles to ready.
  releaseBytes();
  await expect(toast(page(), `Uploaded ${title}.pdf`)).toBeVisible();
  await expect(progress).toBeHidden();
});

test.afterEach(async () => {
  releaseBytes();
  await page().unroute(storageCalls);
});
