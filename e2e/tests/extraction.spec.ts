import { expect, test } from '@playwright/test';
import {
  browseRoot,
  goldenExtraction,
  guestPanel,
  seededPdf,
  signedInPage,
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

  await expect(page().getByRole('status').filter({ hasText: `Uploaded ${title}.pdf` })).toBeVisible();
  const ready = page().getByRole('status').filter({ hasText: `"${title}" is ready` });
  await expect(ready).toBeVisible();

  await ready.getByRole('button', { name: 'View' }).click();

  await expect(page().locator('.reader .title-doc').first()).toHaveText(title);
  await expect(page().getByRole('img', { name: 'Page 1 of 1' })).toBeVisible();
  const panel = guestPanel(page());
  const fixture = goldenExtraction();
  await expect(panel.getByRole('heading', { level: 1, name: title })).toBeVisible();
  await expect(panel.getByText(fixture.plainEnglishSummary)).toBeVisible();
  for (const takeaway of fixture.keyTakeaways) {
    await expect(panel.getByText(takeaway.text)).toBeVisible();
  }
});
