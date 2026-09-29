import { expect, test } from '@playwright/test';
import {
  browseRoot,
  dropFile,
  seededPdf,
  signedInPage,
  tile,
  toast,
  unique,
  uploadViaDialog,
} from './support';

const page = signedInPage();

// Journey: an upload that fails leaves a `failed` tile; dropping the PDF back
// on that tile retries it under the same Document.
test('a failed upload is retried by dropping the PDF on its tile', async () => {
  const title = unique('E2E flaky upload');
  const file = { name: `${title}.pdf`, buffer: seededPdf('versicherungsschein-tk.pdf') };
  await browseRoot(page());

  // The Storage emulator refuses the bytes — a non-retryable error, so the
  // SDK gives up at once rather than backing off.
  const refuseUploads = '**/v0/b/*/o?*';
  await page().route(refuseUploads, (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({ error: { code: 403, message: 'Permission denied.' } }),
        })
      : route.fallback(),
  );
  await uploadViaDialog(page(), [file]);

  const failedTile = tile(page(), title);
  await expect(failedTile.getByText('Upload failed')).toBeVisible();
  await expect(toast(page(), 'Upload failed')).toBeVisible();

  await page().unroute(refuseUploads);
  await dropFile(failedTile, file);

  await expect(toast(page(), `Uploaded ${title}.pdf`)).toBeVisible();
  await expect(failedTile.getByText('Upload failed')).toBeHidden();
  await expect(failedTile).toHaveAttribute('role', 'button');
  await expect(page().locator('app-document-tile').filter({ hasText: title })).toHaveCount(1);
});
