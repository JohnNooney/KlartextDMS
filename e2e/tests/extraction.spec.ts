import { expect, test } from '@playwright/test';
import {
  browseRoot,
  goldenExtraction,
  guestPanel,
  seededPdf,
  signedInPage,
  toast,
  unique,
  uploadViaDialog,
} from './support';

const page = signedInPage();

// Journey: upload a PDF → the background Extraction (fake provider) completes
// → toast → open the Document → the panel shows the fixture Extraction beside
// the pdf.js viewer.
test('an uploaded PDF is analyzed in the background and opens beside its Extraction', async () => {
  const title = unique('E2E upload');
  await browseRoot(page());

  await uploadViaDialog(page(), [{ name: `${title}.pdf`, buffer: seededPdf('mietvertrag-2024.pdf') }]);

  await expect(toast(page(), `Uploaded ${title}.pdf`)).toBeVisible();
  const ready = toast(page(), `"${title}" is ready`);
  await expect(ready).toBeVisible();

  await ready.getByRole('button', { name: 'View' }).click();

  await expect(page().locator('.reader .title-doc').first()).toHaveText(title);
  await expect(page().getByRole('img', { name: 'Page 1 of 4' })).toBeVisible();
  const panel = guestPanel(page());
  const fixture = goldenExtraction();
  // The panel titles itself by document type — the Host toolbar names the Document.
  await expect(
    panel.getByRole('heading', { level: 1, name: 'Service charge statement' }),
  ).toBeVisible();
  await expect(panel.getByText(fixture.plainEnglishSummary)).toBeVisible();
  for (const takeaway of [...fixture.actionItems, ...fixture.keyTakeaways]) {
    await expect(panel.getByText(takeaway.text)).toBeVisible();
  }
});

// Journey: a stored v2 Extraction shows Action Items (with timing chips and
// an Add-reminder affordance) above unnumbered Key Takeaways.
test('Action Items carry timing chips and an Add-reminder button', async () => {
  await page().goto('/folder/wohnung/doc/doc-mietvertrag');
  const panel = guestPanel(page());
  const attention = panel.locator('[data-section="attention"]');
  await expect(attention.locator('[data-timing-chip]').first()).toHaveText('3 months’ notice · moving out');
  await expect(attention.locator('[data-timing-chip]').last()).toHaveText('Monthly by the 3rd working day');
  await expect(attention.locator('li')).toHaveCount(4);
  await expect(attention.getByRole('button', { name: 'Add reminder' })).toHaveCount(4);
  const takeaways = panel.locator('[data-section="takeaways"]');
  await expect(takeaways.locator('li')).toHaveCount(2);
  await expect(takeaways.getByRole('button', { name: 'Add reminder' })).toHaveCount(0);
  await panel.getByRole('button', { name: 'More actions' }).click();
  await expect(panel.getByText('Earlier analysis format')).toBeHidden();
});
