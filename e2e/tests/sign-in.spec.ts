import { expect, test } from '@playwright/test';
import { signIn } from './support';

// Journey: the sign-in gate guards the library; sign-out returns to it.
test('the gate leads to the library and sign-out returns to the gate', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeHidden();

  await signIn(page);

  await expect(page.getByRole('heading', { level: 1, name: 'Documents' })).toBeVisible();
  await expect(page.getByRole('treeitem', { name: 'Verträge' })).toBeVisible();
  await expect(page.locator('.tile-name', { hasText: 'Brief vom Finanzamt' })).toBeVisible();

  await page.getByRole('button', { name: 'Sign out' }).click();

  await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Documents' })).toBeHidden();
});

test('a wrong password stays on the gate', async ({ page }) => {
  await page.goto('/');
  await page.getByPlaceholder('Email').fill('test-user@test.com');
  await page.getByPlaceholder('Password').fill('not-the-password');
  await page.getByRole('button', { name: 'Sign in with email' }).click();

  await expect(page.getByRole('alert')).toHaveText('Wrong email or password.');
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeHidden();
});
