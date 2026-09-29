import { devices, expect, test, type Locator } from '@playwright/test';
import {
  browseRoot,
  expectNoHorizontalOverflow,
  SEED_USER,
  seededPdf,
  signedInPage,
  tile,
  toast,
  unique,
  uploadViaDialog,
} from './support';

// Journey (issue #47): on a phone-sized viewport a long Document title
// ellipsizes instead of pushing the date, the Extraction chip, and the ⋮
// menu off-screen — the page never side-scrolls.
const page = signedInPage({ ...devices['iPhone 13'] });

// Holding back the job's byte fetch keeps the tile's Extraction chip queued
// for the whole row check (same seam as reanalyze.spec); released in
// afterEach so a failed assertion never leaves the route gated.
let releaseBytes: () => void = () => {};
const byteFetches = `**/o/users%2F${SEED_USER.uid}%2Fdocuments%2F**`;

test('a long-titled Document row ellipsizes and never side-scrolls', async () => {
  await browseRoot(page());

  const gate = new Promise<void>((resolve) => (releaseBytes = resolve));
  await page().route(byteFetches, async (route) => {
    await gate;
    await route.fallback().catch(() => {});
  });

  // Long German compounds, free of seeded Folder/Document names — other
  // specs query the tree by substring and must not match this title.
  const title = unique('Lohnfortzahlungsbescheinigung des Arbeitgebers für das Steuerjahr');
  await uploadViaDialog(page(), [{ name: `${title}.pdf`, buffer: seededPdf('mietvertrag-2024.pdf') }]);
  await expect(toast(page(), `Uploaded ${title}.pdf`)).toBeVisible();

  const row = tile(page(), title);
  await row.scrollIntoViewIfNeeded();
  await expect(row).toBeVisible();
  await expect(row.locator('.tile-chip')).toHaveText('Queued');
  await expectNoHorizontalOverflow(page());

  // The name is clipped by the row, rendered with an ellipsis — not wrapped
  // onto a hidden second line and not pushing the row wider.
  const name = row.locator('.tile-name');
  expect(await name.evaluate((el) => getComputedStyle(el).textOverflow)).toBe('ellipsis');
  expect(await name.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);

  // Date, chip, and ⋮ stay entirely inside the screen edge (a bounding box
  // strictly within the viewport — mere intersection isn't enough); the ⋮
  // still opens its menu.
  const expectInsideViewport = async (locator: Locator) => {
    const box = await locator.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(page().viewportSize()!.width);
  };
  await expectInsideViewport(row.locator('.tile-meta'));
  await expectInsideViewport(row.locator('.tile-chip'));
  const more = page().getByRole('button', { name: `More actions for ${title}`, exact: true });
  await expectInsideViewport(more);
  await more.tap();
  await expect(page().getByRole('menuitem', { name: 'Rename' })).toBeVisible();
  await expectNoHorizontalOverflow(page());
  await page().keyboard.press('Escape');
});

test.afterEach(async () => {
  releaseBytes();
  await page().unroute(byteFetches);
});
