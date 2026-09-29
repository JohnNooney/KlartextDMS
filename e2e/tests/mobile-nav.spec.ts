import { devices, expect, test } from '@playwright/test';
import { browseRoot, signedInPage, tile } from './support';

// Journey (issue #55): on a phone-sized viewport the library is push
// navigation — no sidebar tree — so inside a Folder the toolbar's
// ‹ {parent} affordance is the way back up a level.
const page = signedInPage({ ...devices['iPhone 13'] });

test('inside a Folder, ‹ takes you up a level; at root there is none', async () => {
  await browseRoot(page());
  await tile(page(), 'Verträge').click();
  await expect(page().getByRole('heading', { level: 1, name: 'Verträge' })).toBeVisible();

  // A nested Folder names its parent Folder.
  await tile(page(), 'Wohnung').click();
  await expect(page().getByRole('heading', { level: 1, name: 'Wohnung' })).toBeVisible();
  const upOne = page().getByRole('button', { name: 'Back to Verträge' });
  await expect(upOne).toBeVisible();

  await upOne.tap();
  await expect(page().getByRole('heading', { level: 1, name: 'Verträge' })).toBeVisible();

  // A top-level Folder names Documents; at root the affordance is gone.
  const upRoot = page().getByRole('button', { name: 'Back to Documents' });
  await expect(upRoot).toBeVisible();
  await upRoot.tap();
  await expect(page().getByRole('heading', { level: 1, name: 'Documents' })).toBeVisible();
  await expect(page().locator('.back-btn')).toBeHidden();
});
