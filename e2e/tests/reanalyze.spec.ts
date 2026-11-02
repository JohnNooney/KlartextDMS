import { expect, test } from '@playwright/test';
import type { Page, Route } from '@playwright/test';
import {
  guestPanel,
  SEED_USER,
  seededExtraction,
  seededPdf,
  signedInPage,
  tile,
  toast,
  unique,
  uploadViaDialog,
} from './support';

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

  // Issue #159: the Outdated Extraction's meta-line nudge re-analyzes it.
  const nudge = panel.getByTestId('outdated-nudge');
  await expect(nudge).toContainText('Earlier analysis format');
  await nudge.getByRole('button', { name: 'Re-analyze for dates' }).click();

  await expect(panel.getByText(/Re-analy(sis queued|zing)…/)).toBeVisible();
  await expect(nudge).toBeHidden();
  await expect(panel.getByText(fixture.plainEnglishSummary)).toBeVisible();

  await expect(panel.getByText(/Re-analy(sis queued|zing)…/)).toBeHidden();
  await expect(panel.getByText(fixture.plainEnglishSummary)).toBeVisible();
  // Upgraded live to v2: the date chip appears and the earlier-format note is gone.
  await expect(panel.locator('[data-timing-chip]')).toHaveText('Due 31 Jan 2026');
  await panel.getByRole('button', { name: 'More actions' }).click();
  await expect(panel.getByText('Earlier analysis format')).toBeHidden();
  await expect(panel.getByRole('menuitem', { name: 'Re-analyze document' })).toBeEnabled();
  await page().unroute(bytes);
});

// ---- Batch re-analysis (issue #159) -----------------------------------------
// The seed's other Outdated Extractions live in Versicherungen and its nested
// Krankenversicherung: Haftpflicht and Hausrat (Hausrat carries a Done mark)
// directly inside, Zahnzusatz one level down. The TK Versicherungsschein was
// upgraded above, so it counts only under "All documents".

const documentBytes = (id: string) => `**/o/users%2F${SEED_USER.uid}%2Fdocuments%2F${id}.pdf?*`;

/** Holds each listed Document's byte fetch for its delay, so a batch stays observable. */
async function slowBytes(p: Page, delays: Record<string, number>): Promise<() => Promise<void>> {
  const routes = Object.entries(delays).map(([id, ms]) => {
    const url = documentBytes(id);
    const handler = async (route: Route) => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      await route.fallback();
    };
    return { url, handler };
  });
  for (const { url, handler } of routes) await p.route(url, handler);
  return async () => {
    for (const { url, handler } of routes) await p.unroute(url, handler);
  };
}

const batchDialog = () => page().getByRole('dialog', { name: 'Re-analyze documents' });
const strip = () => page().locator('app-batch-progress-strip [role="status"]');

test('phone: the short nudge opens a dialog with the hint on the picked row and a stacked footer', async () => {
  await page().setViewportSize({ width: 390, height: 844 });
  try {
    await page().goto('/folder/versicherungen');
    await page().getByRole('button', { name: 'Re-analyze 3 outdated' }).click();

    const dialog = batchDialog();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('radio', { name: /Outdated format/ })).toBeChecked();
    await expect(dialog.getByText('Analyzed in an earlier format — no dates on Action Items.')).toBeVisible();
    await expect(dialog.getByText('Every analyzed document, including up-to-date ones.')).toBeHidden();
    await expect(dialog.getByText('1 of these documents has items marked Done.', { exact: false })).toBeVisible();

    const primary = await dialog.getByRole('button', { name: 'Re-analyze 3 documents' }).boundingBox();
    const cancel = await dialog.getByRole('button', { name: 'Cancel' }).boundingBox();
    expect(primary!.y).toBeLessThan(cancel!.y);
    expect(Math.abs(primary!.width - cancel!.width)).toBeLessThan(4);

    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    await expect(page().getByRole('button', { name: 'More', exact: true })).toBeVisible();
  } finally {
    await page().setViewportSize({ width: 1280, height: 720 });
  }
});

test('a batch over a nested Folder runs from the nudge; an upload mid-batch runs ahead of it', async () => {
  await page().goto('/folder/versicherungen');
  const meta = page().locator('.meta-line');
  await expect(meta).toContainText('3 use an earlier analysis format — Re-analyze');

  const restore = await slowBytes(page(), {
    'doc-haftpflicht': 6_000,
    'doc-hausrat': 6_000,
    'doc-zahnzusatz': 6_000,
  });
  await meta.getByRole('button', { name: 'Re-analyze', exact: true }).click();

  const dialog = batchDialog();
  await expect(dialog).toContainText('In Versicherungen and the folders inside it.');
  await dialog.getByRole('button', { name: 'Show 3 documents' }).click();
  const zahn = dialog.getByRole('listitem').filter({ hasText: 'Zahnzusatzversicherung' });
  await expect(zahn).toContainText('Krankenversicherung');
  await expect(dialog.getByRole('listitem').filter({ hasText: 'Hausratversicherung' })).toContainText('1 done');
  await dialog.getByRole('button', { name: 'Re-analyze 3 documents' }).click();
  await expect(dialog).toBeHidden();

  await expect(strip()).toContainText('Re-analyzing 1 of 3');
  await expect(meta.getByRole('button', { name: 'Re-analyze', exact: true })).toBeHidden();
  await page().getByRole('button', { name: 'More', exact: true }).click();
  await expect(page().getByRole('menuitem', { name: 'Re-analyzing documents' })).toBeDisabled();
  await page().keyboard.press('Escape');

  // The upload's analysis jumps the batch: it finishes while the batch waits.
  const title = unique('E2E mid-batch upload');
  await uploadViaDialog(page(), [{ name: `${title}.pdf`, buffer: seededPdf('brief-finanzamt.pdf') }]);
  await expect(toast(page(), `"${title}" is ready`)).toBeVisible();
  await expect(strip()).toBeVisible();

  await expect(toast(page(), 'Re-analyzed 3 documents')).toBeVisible({ timeout: 30_000 });
  await expect(strip()).toBeHidden();
  await expect(meta).not.toContainText('earlier analysis format');
  await restore();
  await expect(tile(page(), title)).toBeVisible();
});

test('cancelling mid-batch drops the unstarted members', async () => {
  await page().goto('/folder/versicherungen');
  const restore = await slowBytes(page(), {
    'doc-haftpflicht': 500,
    'doc-hausrat': 20_000,
    'doc-zahnzusatz': 20_000,
    'doc-versicherungsschein': 20_000,
  });
  await page().getByRole('button', { name: 'More', exact: true }).click();
  await page().getByRole('menuitem', { name: 'Re-analyze documents' }).click();

  const dialog = batchDialog();
  await expect(dialog.getByRole('radio', { name: /Outdated format/ })).toBeDisabled();
  await expect(dialog.getByRole('radio', { name: /All documents/ })).toBeChecked();
  await dialog.getByRole('button', { name: /^Re-analyze \d+ documents$/ }).click();

  // Haftpflicht's bytes arrive first and it settles; the rest still wait.
  await expect(strip()).toContainText(/Re-analyzing [2-9] of/);
  await strip().getByRole('button', { name: 'Cancel' }).click();

  const cancelled = toast(page(), 'Re-analysis cancelled');
  await expect(cancelled).toContainText(/\d+ of \d+ done\./);
  await expect(strip()).toBeHidden();
  await restore();
});
