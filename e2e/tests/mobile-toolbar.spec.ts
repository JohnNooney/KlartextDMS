import { devices, expect, test } from '@playwright/test';
import {
  browseRoot,
  createFolder,
  expectInsideViewport,
  expectNoHorizontalOverflow,
  seededPdf,
  signedInPage,
  tile,
  toast,
  unique,
  uploadViaDialog,
} from './support';

// Journey (issue #59): on a phone-width viewport the library header is an
// iOS-style two-part header — a navigation row with ‹ {parent} and a single
// + affordance, the Folder title on its own line at large-title size — and
// toasts anchor to the bottom of the screen, clear of the navigation.
const page = signedInPage({ ...devices['iPhone 13'] });

const addButton = () => page().getByRole('button', { name: 'Add', exact: true });

test('inside a Folder, ‹ and + share a nav row above the large title', async () => {
  await browseRoot(page());
  await tile(page(), 'Verträge').click();
  const title = page().getByRole('heading', { level: 1, name: 'Verträge' });
  await expect(title).toBeVisible();

  const back = page().getByRole('button', { name: 'Back to Documents' });
  const add = addButton();
  const [backBox, addBox, titleBox] = await Promise.all(
    [back, add, title].map(async (locator) => (await locator.boundingBox())!),
  );

  // The nav row: ‹ and + overlap vertically — one shared row…
  expect(backBox.y).toBeLessThan(addBox.y + addBox.height);
  expect(addBox.y).toBeLessThan(backBox.y + backBox.height);
  // …and never overlap horizontally: ‹ left, + right.
  expect(backBox.x + backBox.width).toBeLessThanOrEqual(addBox.x);
  // …and the title renders on its own line below both.
  expect(titleBox.y).toBeGreaterThanOrEqual(Math.max(backBox.y + backBox.height, addBox.y + addBox.height) - 1);

  // Large title spanning nearly the whole row — a long name stays readable
  // instead of truncating to a few characters between the nav controls.
  expect(
    await title.evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
  ).toBeGreaterThanOrEqual(30);
  expect(titleBox.width).toBeGreaterThanOrEqual(page().viewportSize()!.width * 0.8);

  await expectInsideViewport(page(), back);
  await expectInsideViewport(page(), add);
  await expectInsideViewport(page(), title);
  await expectNoHorizontalOverflow(page());
});

test('+ opens the add menu; the New folder pill is gone', async () => {
  await browseRoot(page());

  // The standalone pill is desktop-only now.
  await expect(
    page().locator('.library-toolbar').getByRole('button', { name: 'New folder' }),
  ).toBeHidden();

  await addButton().tap();
  const upload = page().getByRole('menuitem', { name: 'Upload document' });
  const newFolder = page().getByRole('menuitem', { name: 'New folder' });
  await expect(upload).toBeVisible();
  await expect(newFolder).toBeVisible();
  await expectInsideViewport(page(), upload);
  await expectInsideViewport(page(), newFolder);
  await expectNoHorizontalOverflow(page());

  // Each item drives its existing dialog.
  await newFolder.tap();
  const folderDialog = page().getByRole('dialog', { name: 'New folder' });
  await expect(folderDialog).toBeVisible();
  await folderDialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(folderDialog).toBeHidden();

  await addButton().tap();
  await page().getByRole('menuitem', { name: 'Upload document' }).tap();
  const uploadDialog = page().getByRole('dialog', { name: 'Upload documents' });
  await expect(uploadDialog).toBeVisible();
  await uploadDialog.getByRole('button', { name: 'Close' }).click();
  await expect(uploadDialog).toBeHidden();
});

test('a long Folder name stays readable on its own title line', async () => {
  await browseRoot(page());

  const name = unique('Versicherungsunterlagen des Haushalts');
  await createFolder(page(), name);
  await tile(page(), name).tap();
  const title = page().getByRole('heading', { level: 1, name });
  await expect(title).toBeVisible();

  // The title keeps its own full-width line — what shows is a readable
  // fragment of the name, not a few truncated characters.
  const box = (await title.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(page().viewportSize()!.width * 0.8);
  await expectInsideViewport(page(), title);
  await expectNoHorizontalOverflow(page());
});

test('the layout fills the viewport — no clipped or dead bottom edge', async () => {
  await browseRoot(page());

  const viewportHeight = page().viewportSize()!.height;
  const layoutBox = (await page().locator('.layout').boundingBox())!;
  // The shell's bottom edge lands exactly on the visible viewport edge.
  expect(Math.abs(layoutBox.y + layoutBox.height - viewportHeight)).toBeLessThanOrEqual(1);

  // The last row in the library scrolls fully into view.
  const last = page().locator('app-document-tile, app-folder-tile').last();
  await last.scrollIntoViewIfNeeded();
  const box = (await last.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(viewportHeight);
});

test('toasts anchor to the bottom and a long title never overlaps View or ✕', async () => {
  await browseRoot(page());

  // Long enough to need an ellipsis inside a phone-width toast.
  const title = unique('Gewerbesteuererklärung Freistellungsauftrag Rückzahlung');
  await uploadViaDialog(page(), [
    { name: `${title}.pdf`, buffer: seededPdf('mietvertrag-2024.pdf') },
  ]);

  // The upload toast, then the Extraction-ready toast carrying the View action.
  await expect(toast(page(), `Uploaded ${title}.pdf`)).toBeVisible();
  const ready = toast(page(), 'is ready');
  await expect(ready.getByRole('button', { name: 'View' })).toBeVisible();

  const viewport = page().viewportSize()!;
  const stackBox = (await page().locator('.toasts').boundingBox())!;
  // Anchored at the bottom edge (plus the safe-area inset), not top-right.
  expect(stackBox.y + stackBox.height).toBeLessThanOrEqual(viewport.height);
  expect(viewport.height - (stackBox.y + stackBox.height)).toBeLessThan(64);

  const toolbarBox = (await page().locator('.library-toolbar').boundingBox())!;
  expect(stackBox.y).toBeGreaterThan(toolbarBox.y + toolbarBox.height);

  // The title ellipsizes inside its share of the toast…
  const toastEl = ready.first();
  const strong = toastEl.locator('.toast-text strong');
  expect(await strong.evaluate((el) => getComputedStyle(el).textOverflow)).toBe('ellipsis');
  expect(await strong.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);

  // …and neither the action nor ✕ sits on top of the text.
  const [textBox, actionBox, closeBox] = await Promise.all(
    [toastEl.locator('.toast-text'), ready.getByRole('button', { name: 'View' }), toastEl.getByRole('button', { name: /Dismiss/ })]
      .map(async (l) => (await l.boundingBox())!),
  );
  for (const control of [actionBox, closeBox]) {
    expect(control.x).toBeGreaterThanOrEqual(textBox.x + textBox.width - 1);
  }
  await expectInsideViewport(page(), ready);
  await expectNoHorizontalOverflow(page());
});
