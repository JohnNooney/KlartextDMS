import { expect, test } from '@playwright/test';
import { browseRoot, guestPanel, signedInPage, toast } from './support';

const page = signedInPage();

// Journey (issue #144, ADR 0013): "Mark done" hides an Action Item in the
// Host's attention overview — out of the card and its count, into the See
// All sheet's collapsed Done group — with an Undo toast. Every mark this
// file makes is un-marked again so the shared seeded state stays clean.
// The tax-office Document is analyzed after load and its Overdue item
// re-sorts the card when it lands — so every mark targets that item by text,
// never "the first row", which can change under the click.
const TAX_ITEM = 'File your 2023 tax return';

test('the Host hides a Done item and its Undo toast brings it back', async () => {
  await browseRoot(page());
  const overview = page().getByRole('region', { name: 'Needs your attention' });
  const target = TAX_ITEM;
  const row = overview.locator('.attention-row', { hasText: target });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Mark done' }).click();

  // Hidden from the card; the toast offers Undo.
  await expect(toast(page(), 'Marked done')).toBeVisible();
  await expect(overview.locator('.attention-row', { hasText: target })).toHaveCount(0);

  await toast(page(), 'Marked done').getByRole('button', { name: 'Undo' }).click();
  await expect(overview.locator('.attention-row', { hasText: target })).toHaveCount(1);
});

test('the Host’s See All sheet keeps Done items in a collapsed group with un-mark', async () => {
  await browseRoot(page());
  const overview = page().getByRole('region', { name: 'Needs your attention' });

  const target = TAX_ITEM;
  const row = overview.locator('.attention-row', { hasText: target });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Mark done' }).click();
  await expect(toast(page(), 'Marked done')).toBeVisible();

  await overview.getByRole('button', { name: 'See All' }).click();
  const sheet = page().getByRole('dialog', { name: 'Needs your attention' });
  // The item is out of the Urgency groups; the Done group sits collapsed at the bottom.
  await expect(sheet.getByRole('button', { name: new RegExp(escapeRegExp(target)) })).toHaveCount(0);
  // The seed already marks one Hausratversicherung item Done (issue #159).
  const doneToggle = sheet.getByRole('button', { name: 'Done (2)' });
  await expect(doneToggle).toHaveAttribute('aria-expanded', 'false');

  await doneToggle.click();
  await expect(doneToggle).toHaveAttribute('aria-expanded', 'true');
  const doneRow = sheet
    .getByRole('listitem')
    .filter({ has: page().getByRole('button', { name: 'Mark not done' }) })
    .filter({ hasText: target });
  await expect(doneRow).toBeVisible();
  await doneRow.getByRole('button', { name: 'Mark not done' }).click();

  // Un-marked: the group shrinks back and the item is in its Urgency group.
  await expect(sheet.getByRole('button', { name: 'Done (1)' })).toBeVisible();
  await expect(
    sheet.getByRole('button', { name: new RegExp(escapeRegExp(target)) }),
  ).toBeVisible();
  await sheet.getByRole('button', { name: 'Close' }).click();
});

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Journey (issue #144, ADR 0013): the same check on the Guest's Action Item
// card — marked optimistically, moved to the collapsed Done group, and
// returned by unticking. The seeded rent item was marked through its last
// occurrence, so it has already returned to the pending list.
test('the Guest moves a Done item to the collapsed group and unticking returns it', async () => {
  await page().goto('/folder/wohnung/doc/doc-mietvertrag');
  const panel = guestPanel(page());
  const attention = panel.locator('[data-section="attention"]');

  // Recurrence return: the seeded Done mark covered a past occurrence, so
  // the rent item sits pending again — not Done.
  const rentRow = attention.locator('li', { hasText: 'Rent is due by the third working day' });
  await expect(rentRow).toBeVisible();
  await expect(attention.getByRole('button', { name: /Done \(/ })).toHaveCount(0);

  // Mark it done — it leaves the pending list for the collapsed group.
  await rentRow.getByRole('checkbox', { name: 'Mark done' }).click();
  await expect(attention.locator('li', { hasText: 'Rent is due' })).toHaveCount(0);

  const doneToggle = attention.getByRole('button', { name: 'Done (1)' });
  await doneToggle.click();
  const doneRow = attention.locator('li', { hasText: 'Rent is due' });
  await expect(doneRow).toBeVisible();
  // Done rows are muted: no timing chip, no Reminder button.
  await expect(doneRow.locator('[data-timing-chip]')).toHaveCount(0);
  await expect(doneRow.getByRole('button', { name: 'Add reminder' })).toHaveCount(0);

  // Unticking returns it to the pending list.
  await doneRow.getByRole('checkbox', { name: 'Mark not done' }).click();
  await expect(attention.locator('li', { hasText: 'Rent is due' })).toHaveCount(1);
});
