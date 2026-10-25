import { expect, test } from '@playwright/test';
import { browseRoot, expectNoHorizontalOverflow, signedInPage } from './support';

const page = signedInPage();

const field = () => page().getByRole('searchbox', { name: 'Search the library' });
const results = () => page().getByRole('region', { name: 'Search results' });

// Journey (issue #121): the toolbar field searches Document titles and
// filenames, Folder names/keywords/descriptions, and Extraction insights.
// A query lands in the URL as ?q= so browser back out of a result returns to
// the same results; item and quote matches open at the cited page.
test('the toolbar field finds an Extraction insight and opens the Document at its page', async () => {
  await browseRoot(page());

  // `/` focuses the field.
  await page().keyboard.press('/');
  await expect(field()).toBeFocused();

  // An English term matches the Mietvertrag's Action Item — reason badge and
  // snippet on the row, folder path alongside the title.
  await field().fill('deposit');
  await expect(page()).toHaveURL(/folder\/root\?q=deposit/);
  await expect(results()).toBeVisible();
  const row = results().getByRole('button', { name: /Mietvertrag 2024/ });
  await expect(row).toContainText('Action item');
  await expect(row).toContainText('deposit');
  await expect(row).toContainText('Verträge / Wohnung');

  // The click-through lands on the cited page with the quote highlighted.
  await row.click();
  await expect(page().locator('.pdf-pageno')).toHaveText('2 / 4');
  await expect(page().locator('.pdf-text-layer .pdf-hit').first()).toBeVisible();
});

test('a German term hits the same Document through its quoted clause; back returns to the results', async () => {
  await browseRoot(page());
  await field().fill('Kaution');

  const row = results().getByRole('button', { name: /Mietvertrag 2024/ });
  await expect(row).toContainText('Quote');
  await expect(row).toContainText('Kaution');
  await row.click();
  await expect(page().locator('.pdf-pageno')).toHaveText('2 / 4');

  // ?q= round-trip: back out of the Document lands on the same results.
  await page().goBack();
  await expect(page()).toHaveURL(/folder\/root\?q=Kaution/);
  await expect(field()).toHaveValue('Kaution');
  await expect(results().getByRole('button', { name: /Mietvertrag 2024/ })).toBeVisible();
});

test('the scope pill widens a Folder-scoped search to All documents', async () => {
  await page().goto('/folder/vertraege');
  await expect(page().getByRole('heading', { level: 1, name: 'Verträge' })).toBeVisible();

  // "tax" hits nothing under Verträge — the tax Document lives at root and
  // Behörden's keyword outside the subtree.
  await field().fill('tax');
  await expect(results().getByText('No matches for “tax”.')).toBeVisible();

  const pill = page().getByRole('group', { name: 'Search scope' });
  await pill.getByRole('button', { name: 'All documents' }).click();
  await expect(page()).toHaveURL(/scope=all/);

  // Folders list above Documents: Behörden by its keyword, then the tax letter.
  const rows = results().locator('.result-row');
  await expect(rows.first()).toContainText('Behörden');
  await expect(rows.first()).toContainText('Keywords');
  await expect(results().getByRole('button', { name: /Brief vom Finanzamt/ })).toBeVisible();

  // A Folder result browses into it.
  await rows.first().click();
  await expect(page().getByRole('heading', { level: 1, name: 'Behörden' })).toBeVisible();
});

test('folded diacritics find Behörden and normalized v1 Extractions answer too', async () => {
  await browseRoot(page());

  // The English-keyboard spelling finds the umlauted Folder name.
  await field().fill('behoerden');
  await expect(results().getByRole('button', { name: /Behörden/ })).toBeVisible();

  // The v1-stored Versicherungsschein Extraction, normalized on read, still
  // answers for its Key Takeaway.
  await field().fill('teeth');
  const row = results().getByRole('button', { name: /Versicherungsschein TK/ });
  await expect(row).toContainText('Key takeaway');
  await expect(row).toContainText('teeth cleaning');
  await row.click();
  await expect(page().locator('.pdf-pageno')).toHaveText('2 / 2');
});

test('the mobile magnifier reveals the field and search stays inside the viewport', async () => {
  await page().setViewportSize({ width: 390, height: 844 });
  await browseRoot(page());

  const magnifier = page().getByRole('button', { name: 'Search', exact: true });
  await expect(magnifier).toBeVisible();
  await magnifier.click();
  await expect(field()).toBeFocused();

  await field().fill('mietvertrag');
  await expect(results().getByRole('button', { name: /Mietvertrag 2024/ })).toBeVisible();
  await expectNoHorizontalOverflow(page());

  await page().setViewportSize({ width: 1280, height: 800 });
});

test('the mobile field collapses on blur and on navigation', async () => {
  await page().setViewportSize({ width: 390, height: 844 });
  await browseRoot(page());

  const magnifier = page().getByRole('button', { name: 'Search', exact: true });
  await magnifier.click();
  await expect(field()).toBeFocused();

  // The ✕ sits where desktop shows the / hint — it collapses the field.
  await page().getByRole('button', { name: 'Close search' }).click();
  await expect(field()).toBeHidden();
  await expect(magnifier).toBeVisible();

  // So does tapping away with an empty field.
  await magnifier.click();
  await expect(field()).toBeFocused();
  await page().locator('.library-drop').click({ position: { x: 12, y: 12 } });
  await expect(field()).toBeHidden();
  await expect(magnifier).toBeVisible();

  // Navigating doesn't leave it expanded either — the Folder result opens
  // and the title takes its row back.
  await magnifier.click();
  await field().fill('vertrag');
  await results().getByRole('button', { name: /^Verträge/ }).click();
  await expect(field()).toBeHidden();
  await expect(magnifier).toBeVisible();
  await expect(page().getByRole('heading', { name: 'Verträge' })).toBeVisible();

  await page().setViewportSize({ width: 1280, height: 800 });
});
