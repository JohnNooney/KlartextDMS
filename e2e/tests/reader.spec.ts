import { expect, test } from '@playwright/test';
import {
  browseRoot,
  guestPanel,
  makePdf,
  seededExtraction,
  seededPdf,
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
  await expect(panel.getByRole('heading', { level: 1, name: 'Tenancy agreement' })).toBeVisible();
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

// Journey (issue #76): the toolbar's sidebar toggle hides the Guest's
// insights lane — the PDF reflows to the window's right edge — and shows it
// again. The iframe stays mounted so an in-flight Extraction Job still
// lands; and hiding is forgotten — the next Document opens with the lane.
test('the toolbar toggle hides and re-shows the insights lane', async () => {
  const title = unique('E2E lane');
  await browseRoot(page());
  await uploadViaDialog(page(), [
    { name: `${title}.pdf`, buffer: seededPdf('mietvertrag-2024.pdf') },
  ]);
  await expect(toast(page(), `Uploaded ${title}.pdf`)).toBeVisible();

  await tile(page(), title).click();
  const lane = page().locator('.guest-frame-host');
  const hide = page().getByRole('button', { name: 'Hide insights' });
  await expect(hide).toBeVisible();
  await expect(hide).toHaveAttribute('aria-pressed', 'true');
  await expect(lane).toBeVisible();

  // Hide: the lane collapses and the PDF pane takes its width — its right
  // edge lands on the reader's own edge, grown by the lane's 400px.
  const paneRight = () =>
    page().locator('.pdf-pane').evaluate((el) => el.getBoundingClientRect().right);
  const before = await paneRight();
  await hide.click();
  await expect(lane).toBeHidden();
  const show = page().getByRole('button', { name: 'Show insights' });
  await expect(show).toHaveAttribute('aria-pressed', 'false');
  const readerRight = await page()
    .locator('.reader')
    .evaluate((el) => el.getBoundingClientRect().right);
  expect(await paneRight()).toBeGreaterThanOrEqual(readerRight - 1);
  expect((await paneRight()) - before).toBeGreaterThanOrEqual(390); // ≈ the 400px lane

  // The frame stays mounted — an in-flight Extraction Job still lands.
  await expect(page().locator('iframe[title="Klartext insights panel"]')).toBeAttached();
  await expect(toast(page(), `"${title}" is ready`)).toBeVisible();

  // Show: the lane returns…
  await show.click();
  await expect(lane).toBeVisible();

  // …and hiding is forgotten: the next Document opens with the lane shown.
  await page().getByRole('button', { name: 'Hide insights' }).click();
  await expect(lane).toBeHidden();
  await page().goto('/folder/wohnung/doc/doc-mietvertrag');
  await expect(lane).toBeVisible();
});

// Journey (issue #78): selecting a Key Takeaway with a page sends
// GUEST_SHOW_PAGE — the Host's PDF jumps to the referenced page.
test('a Key Takeaway jumps the PDF to its page', async () => {
  await page().goto('/folder/wohnung/doc/doc-mietvertrag');
  await expect(page().getByRole('img', { name: 'Page 1 of 4' })).toBeVisible();
  const panel = guestPanel(page());
  await expect(panel.getByRole('heading', { name: 'Tenancy agreement' })).toBeVisible();

  // The first Critical Warning points at page 3 (seeded fixture).
  await panel.getByRole('button', { name: /three months' notice/ }).click();
  await expect(page().locator('.pdf-pageno')).toHaveText('3 / 4');
  await expect(page().getByRole('img', { name: 'Page 3 of 4' })).toBeVisible();

  // A normal takeaway lands too — "small repairs" points at page 4.
  await panel.getByRole('button', { name: /small repairs/ }).click();
  await expect(page().locator('.pdf-pageno')).toHaveText('4 / 4');
});

// Journey (issue #80): a Key Takeaway's sourceQuote highlights the quoted
// passage in the PDF's text layer — the tint sits over the cited text and
// stays aligned after zoom. The first Critical Warning quotes page 3's
// Kündigungsfrist clause in the seeded fixture.
test('a Key Takeaway highlights its quoted passage on the page', async () => {
  await page().goto('/folder/wohnung/doc/doc-mietvertrag');
  await expect(page().getByRole('img', { name: 'Page 1 of 4' })).toBeVisible();
  const panel = guestPanel(page());
  await expect(panel.getByRole('heading', { name: 'Tenancy agreement' })).toBeVisible();

  await panel.getByRole('button', { name: /three months' notice/ }).click();
  await expect(page().locator('.pdf-pageno')).toHaveText('3 / 4');

  const hits = page().locator('.pdf-text-layer .pdf-hit');
  await expect(hits.first()).toBeVisible();

  // The layer is invisible and laid out by pdf.js — runtime-created spans
  // must pick up its styles (absolute, transparent), not flow as body text.
  const layout = await page().evaluate(() =>
    [...document.querySelectorAll('.pdf-text-layer > span')].map((s) => {
      const cs = getComputedStyle(s);
      return `${cs.position} ${cs.color}`;
    }),
  );
  expect(layout.length).toBeGreaterThan(0);
  expect(new Set(layout)).toEqual(new Set(['absolute rgba(0, 0, 0, 0)']));
  // The passage belongs to a Critical Warning — warning tint, not accent.
  await expect(hits.first()).toHaveClass(/pdf-hit--critical/);

  // The highlight overlaps the quoted passage: a text-layer span carrying
  // "Kündigung bedarf" sits under the hit's box, inside the page sheet.
  const overlap = () =>
    page().evaluate(() => {
      const hit = document.querySelector('.pdf-text-layer .pdf-hit');
      const sheet = document.querySelector('.pdf-sheet');
      const span = [...document.querySelectorAll('.pdf-text-layer > span')].find((s) =>
        s.textContent?.includes('Kündigung bedarf'),
      );
      if (!hit || !sheet || !span) return null;
      const h = hit.getBoundingClientRect();
      const sh = sheet.getBoundingClientRect();
      const sp = span.getBoundingClientRect();
      return {
        nonEmpty: h.width > 0 && h.height > 0,
        insideSheet:
          h.left >= sh.left - 1 &&
          h.right <= sh.right + 1 &&
          h.top >= sh.top - 1 &&
          h.bottom <= sh.bottom + 1,
        overlapsText:
          h.left <= sp.right && h.right >= sp.left && h.top <= sp.bottom && h.bottom >= sp.top,
      };
    });
  expect(await overlap()).toEqual({ nonEmpty: true, insideSheet: true, overlapsText: true });

  // Zoom re-fits the layer — the highlight stays over its passage. The
  // rebuild wipes and repours the layer async, so poll the geometry
  // instead of sampling between teardown and repour (#90).
  await page().getByRole('button', { name: 'Zoom in' }).click();
  await expect(async () => {
    expect(await overlap()).toEqual({ nonEmpty: true, insideSheet: true, overlapsText: true });
  }).toPass();
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
