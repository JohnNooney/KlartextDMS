import { expect, test } from '@playwright/test';
import {
  browseRoot,
  guestPanel,
  makePdf,
  seededExtraction,
  signedInPage,
  toast,
  tile,
  unique,
  uploadViaDialog,
} from './support';

const page = signedInPage();

// Journey: a seeded Document opens with its stored Extraction in the panel.
test('a filed Document opens with its stored Extraction beside the PDF', async () => {
  await page().goto('/folder/root');
  await page().getByRole('button', { name: 'Expand Verträge' }).click();
  await page().getByRole('treeitem', { name: 'Wohnung' }).click();
  await expect(page().getByRole('heading', { level: 1, name: 'Wohnung' })).toBeVisible();

  await tile(page(), 'Mietvertrag 2024').click();

  await expect(page().getByRole('img', { name: 'Page 1 of 4' })).toBeVisible();
  const panel = guestPanel(page());
  const fixture = seededExtraction('doc-mietvertrag');
  await expect(panel.getByRole('heading', { level: 1, name: 'Mietvertrag 2024' })).toBeVisible();
  await expect(panel.getByText(fixture.plainEnglishSummary)).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'Needs your attention' })).toBeVisible();

  await page().getByRole('button', { name: 'Back to Wohnung' }).click();
  await expect(page().getByRole('heading', { level: 1, name: 'Wohnung' })).toBeVisible();
});

// Journey: paging through a multi-page Document in the pdf.js viewer.
test('the viewer pages through a multi-page Document', async () => {
  const title = unique('E2E paging');
  await browseRoot(page());
  await uploadViaDialog(page(), [{ name: `${title}.pdf`, buffer: makePdf(['One', 'Two', 'Three']) }]);
  await expect(toast(page(), `Uploaded ${title}.pdf`)).toBeVisible();

  await tile(page(), title).click();

  const pageNo = page().locator('.pdf-pageno');
  const next = page().getByRole('button', { name: 'Next page' });
  const prev = page().getByRole('button', { name: 'Previous page' });
  await expect(pageNo).toHaveText('1 / 3');
  await expect(prev).toBeDisabled();

  await next.click();
  await expect(pageNo).toHaveText('2 / 3');
  await expect(page().getByRole('img', { name: 'Page 2 of 3' })).toBeVisible();

  await next.click();
  await expect(pageNo).toHaveText('3 / 3');
  await expect(next).toBeDisabled();

  await prev.click();
  await expect(pageNo).toHaveText('2 / 3');
});

// Journey (issue #66): a page zoomed wider than the stage must keep its left
// edge on-screen — the sheet start-aligns once it overflows, so the stage
// scrolls right instead of centring the overflow off the reachable region.
test('a zoomed page keeps its left edge on-screen and scrolls right', async () => {
  await browseRoot(page());
  await page().getByRole('button', { name: 'Expand Verträge' }).click();
  await page().getByRole('treeitem', { name: 'Wohnung' }).click();
  await tile(page(), 'Mietvertrag 2024').click();
  await expect(page().getByRole('img', { name: 'Page 1 of 4' })).toBeVisible();

  const zoom = page().getByRole('button', { name: 'Zoom in' });
  const stage = page().locator('.pdf-stage');
  const sheet = page().locator('.pdf-sheet');

  // Zoom until the sheet is wider than the stage (each click re-renders async).
  for (let i = 0; i < 12; i++) {
    if (await zoom.isDisabled()) break;
    const [s, w] = await Promise.all([stage.boundingBox(), sheet.boundingBox()]);
    if (s && w && w.width > s.width) break;
    await zoom.click();
    await page().waitForTimeout(150);
  }

  const [stageBox, sheetBox] = await Promise.all([stage.boundingBox(), sheet.boundingBox()]);
  expect(sheetBox!.width).toBeGreaterThan(stageBox!.width);
  // The left edge starts inside the stage — nothing clipped, scroll origin.
  expect(sheetBox!.x).toBeGreaterThanOrEqual(stageBox!.x - 1);

  // …and the right edge is reachable by scrolling right.
  await stage.evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
  });
  const [scrolledSheet, scrolledStage] = await Promise.all([
    sheet.boundingBox(),
    stage.boundingBox(),
  ]);
  expect(scrolledSheet!.x + scrolledSheet!.width).toBeLessThanOrEqual(
    scrolledStage!.x + scrolledStage!.width + 1,
  );
});
