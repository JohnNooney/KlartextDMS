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

  await expect(page().getByRole('img', { name: 'Page 1 of 1' })).toBeVisible();
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
