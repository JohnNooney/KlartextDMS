import { expect, test } from '@playwright/test';
import { browseRoot, signedInPage } from './support';

const page = signedInPage();

// Journey (issue #120): the Folder attention overview rolls up Action Items
// from every Document below the browsed Folder. The card shows the most
// urgent few on one line each; See All opens the full grouped list, and
// clicking an item there opens its Document at the cited page and
// highlights the quote.
test('the attention overview lists deep Action Items and opens a Document at the cited page', async () => {
  await browseRoot(page());
  const overview = page().getByRole('region', { name: 'Needs your attention' });
  await expect(overview).toBeVisible();

  // The tax-office Document has no stored Extraction: its job finishes after
  // load, and its dated item (due 2024-07-31) leads the card as Overdue.
  const overdue = overview.getByRole('button', { name: /File your 2023 tax return/ });
  await expect(overdue).toContainText('Overdue');

  // The chevron header collapses the card to its title.
  const header = overview.getByRole('button', { name: /^Needs your attention/ });
  await header.click();
  await expect(header).toHaveAttribute('aria-expanded', 'false');
  await expect(overdue).toBeHidden();
  await expect(overview.getByRole('button', { name: 'See All' })).toBeHidden();
  await header.click();

  await overview.getByRole('button', { name: 'See All' }).click();
  const sheet = page().getByRole('dialog', { name: 'Needs your attention' });
  await expect(sheet.getByRole('heading', { name: 'Overdue' })).toBeVisible();
  await expect(sheet.getByRole('heading', { name: 'No date' })).toBeVisible();
  await expect(sheet.getByRole('button', { name: /File your 2023 tax return/ })).toContainText(' days ago');
  const row = sheet.getByRole('button', { name: /Notice must be given in writing/ });
  await expect(row).toContainText('Mietvertrag 2024');
  await expect(row).toContainText('Verträge / Wohnung');
  await expect(row).toContainText('p. 3');

  await row.click();
  await expect(sheet).toBeHidden();
  await expect(page().locator('.pdf-pageno')).toHaveText('3 / 4');
  await expect(page().locator('.pdf-text-layer .pdf-hit').first()).toBeVisible();
});
