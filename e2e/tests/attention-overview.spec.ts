import { expect, test } from '@playwright/test';
import { browseRoot, signedInPage } from './support';

const page = signedInPage();

// Journey (issue #120): the Folder attention overview rolls up Action Items
// from every Document below the browsed Folder; clicking one opens its
// Document at the cited page and highlights the quote.
test('the attention overview lists deep Action Items and opens a Document at the cited page', async () => {
  await browseRoot(page());
  const overview = page().getByRole('region', { name: 'Needs your attention' });
  await expect(overview).toBeVisible();

  // The tax-office Document has no stored Extraction: its job finishes after
  // load, and its dated item arrives under Overdue (due 2024-07-31).
  const overdue = overview.getByRole('button', { name: /File your 2023 tax return/ });
  await expect(overview.getByRole('heading', { name: /Overdue/ })).toBeVisible();
  await expect(overdue).toContainText(' days ago');
  const row = overview.getByRole('button', { name: /Notice must be given in writing/ });
  await expect(row).toBeVisible();
  await expect(row).toContainText('Mietvertrag 2024');
  await expect(row).toContainText('Verträge / Wohnung');

  await overview.getByRole('button', { name: 'Needs your attention' }).click();
  await expect(row).toBeHidden();
  await overview.getByRole('button', { name: 'Needs your attention' }).click();

  await row.click();
  await expect(page().locator('.pdf-pageno')).toHaveText('3 / 4');
  await expect(page().locator('.pdf-text-layer .pdf-hit').first()).toBeVisible();
});
