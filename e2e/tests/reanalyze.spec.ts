import { expect, test } from '@playwright/test';
import { guestPanel, SEED_USER, seededExtraction, signedInPage } from './support';

const page = signedInPage();

// Journey: re-analyzing an open Document from the panel's ⋯ menu — the stored
// Extraction stays readable while the new one is produced.
test('re-analyze runs a fresh Extraction while the stored one stays readable', async () => {
  await page().goto('/folder/kranken/doc/doc-versicherungsschein');
  const panel = guestPanel(page());
  const fixture = seededExtraction('doc-versicherungsschein');
  await expect(panel.getByText(fixture.plainEnglishSummary)).toBeVisible();
  await expect(page().getByRole('img', { name: /^Page 1 of/ })).toBeVisible();
  // Seeded as a stored schemaVersion 1 record (ADR 0010): its CRITICAL
  // takeaway is read as an Action Item under "Needs your attention".
  await expect(panel.locator('[data-section="attention"]')).toContainText(
    fixture.actionItems[0]!.text,
  );

  // Stored v1: no dates, so the ⋯ menu notes the earlier format.
  await expect(panel.locator('[data-timing-chip]')).toHaveCount(0);
  await panel.getByRole('button', { name: 'More actions' }).click();
  await expect(panel.getByText('Earlier analysis format — re-analyze for dates')).toBeVisible();
  await panel.getByRole('button', { name: 'More actions' }).click();

  // Slow the Host's byte fetch for the job so the queued state is observable.
  const bytes = `**/o/users%2F${SEED_USER.uid}%2Fdocuments%2Fdoc-versicherungsschein.pdf?*`;
  await page().route(bytes, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    await route.fallback();
  });

  await panel.getByRole('button', { name: 'More actions' }).click();
  await panel.getByRole('button', { name: 'Re-analyze document' }).click();

  await expect(panel.getByText(/Re-analy(sis queued|zing)…/)).toBeVisible();
  await expect(panel.getByText(fixture.plainEnglishSummary)).toBeVisible();

  await expect(panel.getByText(/Re-analy(sis queued|zing)…/)).toBeHidden();
  await expect(panel.getByText(fixture.plainEnglishSummary)).toBeVisible();
  // Upgraded live to v2: the date chip appears and the earlier-format note is gone.
  await expect(panel.locator('[data-timing-chip]')).toHaveText('Due 31 Jan 2026');
  await panel.getByRole('button', { name: 'More actions' }).click();
  await expect(panel.getByText('Earlier analysis format')).toBeHidden();
  await expect(panel.getByRole('button', { name: 'Re-analyze document' })).toBeEnabled();
  await page().unroute(bytes);
});
