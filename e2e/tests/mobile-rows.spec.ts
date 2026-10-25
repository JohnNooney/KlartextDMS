import { devices, expect, test, type Locator } from '@playwright/test';
import {
  browseRoot,
  createFolder,
  expectInsideViewport,
  expectNoHorizontalOverflow,
  SEED_USER,
  seededPdf,
  signedInPage,
  tile,
  tileAction,
  toast,
  unique,
  uploadViaDialog,
} from './support';

// Journey (issue #47): on a phone-sized viewport a long Document title
// ellipsizes instead of pushing the date, the Extraction chip, and the ⋮
// menu off-screen — the page never side-scrolls.
const page = signedInPage({ ...devices['iPhone 13'] });

// Holding back the job's byte fetch keeps the tile's Extraction chip queued
// for the whole row check (same seam as reanalyze.spec); released in
// afterEach so a failed assertion never leaves the route gated.
let releaseBytes: () => void = () => {};
const byteFetches = `**/o/users%2F${SEED_USER.uid}%2Fdocuments%2F**`;

test('a long-titled Document row ellipsizes and never side-scrolls', async () => {
  await browseRoot(page());

  const gate = new Promise<void>((resolve) => (releaseBytes = resolve));
  await page().route(byteFetches, async (route) => {
    await gate;
    await route.fallback().catch(() => {});
  });

  // Long German compounds, free of seeded Folder/Document names — other
  // specs query the tree by substring and must not match this title.
  const title = unique('Lohnfortzahlungsbescheinigung des Arbeitgebers für das Steuerjahr');
  await uploadViaDialog(page(), [{ name: `${title}.pdf`, buffer: seededPdf('mietvertrag-2024.pdf') }]);
  await expect(toast(page(), `Uploaded ${title}.pdf`)).toBeVisible();

  const row = tile(page(), title);
  await row.scrollIntoViewIfNeeded();
  await expect(row).toBeVisible();
  await expect(row.locator('.tile-chip')).toHaveText('Queued');
  await expectNoHorizontalOverflow(page());

  // The name is clipped by the row, rendered with an ellipsis — not wrapped
  // onto a hidden second line and not pushing the row wider.
  const name = row.locator('.tile-name');
  expect(await name.evaluate((el) => getComputedStyle(el).textOverflow)).toBe('ellipsis');
  expect(await name.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);

  // Date, chip, and ⋮ stay entirely inside the screen edge; the ⋮ still
  // opens its menu.
  await expectInsideViewport(page(), row.locator('.tile-meta'));
  await expectInsideViewport(page(), row.locator('.tile-chip'));
  const more = page().getByRole('button', { name: `More actions for ${title}`, exact: true });
  await expectInsideViewport(page(), more);
  await more.tap();
  await expect(page().getByRole('menuitem', { name: 'Rename' })).toBeVisible();
  await expectNoHorizontalOverflow(page());
  await page().keyboard.press('Escape');
});

test('adjacent Folder rows keep clear vertical separation and row padding around the folder icon (issue #97)', async () => {
  await browseRoot(page());

  const folders = page().locator('app-folder-tile');
  const first = folders.nth(0);
  const second = folders.nth(1);
  await expect(first).toBeVisible();
  await expect(second).toBeVisible();

  const [firstRow, firstIcon, secondRow, secondIcon] = await Promise.all([
    first.boundingBox(),
    first.locator('.tile-thumb svg').boundingBox(),
    second.boundingBox(),
    second.locator('.tile-thumb svg').boundingBox(),
  ]);
  expect(firstRow).not.toBeNull();
  expect(firstIcon).not.toBeNull();
  expect(secondRow).not.toBeNull();
  expect(secondIcon).not.toBeNull();
  expect({ width: firstIcon!.width, height: firstIcon!.height }).toEqual({ width: 44, height: 36 });

  // Adjacent Folder rows and their icons stay clearly separated vertically.
  expect(secondRow!.y).toBeGreaterThanOrEqual(firstRow!.y + firstRow!.height);
  expect(secondIcon!.y - (firstIcon!.y + firstIcon!.height)).toBeGreaterThanOrEqual(16);

  // Opening ⋮ highlights the Folder row (.has-menu); the folder graphic sits
  // inside the row's border/background with visible top, bottom, and left padding.
  await first.locator('.tile-more').tap();
  await expect(first).toHaveClass(/has-menu/);

  const [activeRow, activeIcon] = await Promise.all([
    first.boundingBox(),
    first.locator('.tile-thumb svg').boundingBox(),
  ]);
  expect(activeIcon!.y - activeRow!.y).toBeGreaterThanOrEqual(6);
  expect(activeRow!.y + activeRow!.height - (activeIcon!.y + activeIcon!.height)).toBeGreaterThanOrEqual(6);
  expect(activeIcon!.x - activeRow!.x).toBeGreaterThanOrEqual(8);

  await page().keyboard.press('Escape');
});

async function expectDialogContentsContained(dialog: Locator, parts: Locator[]): Promise<void> {
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await expectNoHorizontalOverflow(page());
  const dialogBox = (await dialog.boundingBox())!;
  expect(dialogBox).not.toBeNull();
  for (const part of parts) {
    await expectInsideViewport(page(), part);
    const childBox = (await part.boundingBox())!;
    expect(childBox).not.toBeNull();
    expect(childBox.x).toBeGreaterThanOrEqual(dialogBox.x - 1);
    expect(childBox.x + childBox.width).toBeLessThanOrEqual(dialogBox.x + dialogBox.width + 1);
  }
}

test('Move and Delete dialogs wrap long unbroken Document and Folder names inside the dialog (issue #97)', async () => {
  await browseRoot(page());

  const docTitle = unique(
    'Nebenkostenabrechnung_WE127_Anlage_Hausordnung_Abrechnungsjahr_2026',
  ).replaceAll(' ', '_');
  const folderName = unique(
    'Steuerbescheide_Einkommensteuer_Umsatzsteuer_Vorauszahlung_WE127',
  ).replaceAll(' ', '_');

  await uploadViaDialog(page(), [
    { name: `${docTitle}.pdf`, buffer: seededPdf('mietvertrag-2024.pdf') },
  ]);
  await expect(toast(page(), `Uploaded ${docTitle}.pdf`)).toBeVisible();
  await createFolder(page(), folderName);

  for (const [name, deleteHeading] of [
    [docTitle, 'Delete document'],
    [folderName, 'Delete folder'],
  ] as const) {
    await tile(page(), name).scrollIntoViewIfNeeded();
    await tileAction(page(), name, 'Move to…');
    const moveDialog = page().getByRole('dialog', { name: `Move “${name}”` });
    await expect(moveDialog).toBeVisible();

    const heading = moveDialog.locator('.dialog-head h2');
    const closeBtn = moveDialog.getByRole('button', { name: 'Close' });
    const picker = moveDialog.getByTestId('folder-picker');
    const cancelBtn = moveDialog.getByRole('button', { name: 'Cancel' });
    const moveBtn = moveDialog.getByRole('button', { name: 'Move' });

    await expectDialogContentsContained(moveDialog, [
      heading,
      closeBtn,
      picker,
      cancelBtn,
      moveBtn,
    ]);
    const [headBox, closeBox] = await Promise.all([heading.boundingBox(), closeBtn.boundingBox()]);
    expect(closeBox!.x).toBeGreaterThanOrEqual(headBox!.x + headBox!.width - 1);

    await cancelBtn.click();
    await expect(moveDialog).toBeHidden();

    await tileAction(page(), name, 'Delete');
    const deleteDialog = page().getByRole('alertdialog', { name: deleteHeading });
    await expect(deleteDialog).toBeVisible();

    const body = deleteDialog.locator('.dialog-body');
    const deleteClose = deleteDialog.getByRole('button', { name: 'Close' });
    const deleteCancel = deleteDialog.getByRole('button', { name: 'Cancel' });
    const deleteConfirm = deleteDialog.getByRole('button', { name: 'Delete' });

    await expectDialogContentsContained(deleteDialog, [
      body,
      deleteClose,
      deleteCancel,
      deleteConfirm,
    ]);

    await deleteCancel.click();
    await expect(deleteDialog).toBeHidden();
  }
});

// Issue #120: on a phone the attention card's rows stay one ellipsized line
// with their timing and disclosure on screen, and the See All sheet wraps a
// long unbroken Document title and Folder path instead of side-scrolling.
test('the attention card and its See All sheet fit a phone with long unbroken names', async () => {
  await browseRoot(page());

  const docTitle = unique('Betriebskostenabrechnung_Wohnanlage_Gartenstrasse_Abrechnungszeitraum').replaceAll(' ', '_');
  const folderName = unique('Mietunterlagen_Wohnanlage_Gartenstrasse_Nebenkostenbelege').replaceAll(' ', '_');
  await createFolder(page(), folderName);
  await tile(page(), folderName).click();
  await expect(page().getByRole('heading', { level: 1, name: folderName })).toBeVisible();
  await uploadViaDialog(page(), [{ name: `${docTitle}.pdf`, buffer: seededPdf('mietvertrag-2024.pdf') }]);
  await expect(toast(page(), `Uploaded ${docTitle}.pdf`)).toBeVisible();
  await browseRoot(page());

  const overview = page().getByRole('region', { name: 'Needs your attention' });
  const cardRows = overview.locator('.attention-row');
  await expect(cardRows).toHaveCount(3);
  for (const cardRow of await cardRows.all()) {
    expect(await cardRow.locator('.attention-text').evaluate((el) => getComputedStyle(el).textOverflow)).toBe('ellipsis');
    await expectInsideViewport(page(), cardRow);
    await expectInsideViewport(page(), cardRow.locator('.attention-disclosure'));
  }
  await expectInsideViewport(page(), overview.locator('.attention-when').first());
  await expectNoHorizontalOverflow(page());

  // The full title is the sheet row's accessible name; the fake provider's
  // golden Extraction cites page 1.
  await overview.getByRole('button', { name: 'See All' }).click();
  const sheet = page().getByRole('dialog', { name: 'Needs your attention' });
  const row = sheet.getByRole('button', { name: docTitle });
  await row.scrollIntoViewIfNeeded();
  await expect(row.locator('.sheet-doc')).toHaveText(`${docTitle} · ${folderName}`);
  await expect(row.locator('.sheet-page')).toHaveText('p. 1');
  await expectInsideViewport(page(), row);
  await expectInsideViewport(page(), row.locator('.sheet-doc'));
  await expectInsideViewport(page(), row.locator('.sheet-page'));
  await expectNoHorizontalOverflow(page());
  await sheet.getByRole('button', { name: 'Done' }).click();
  await expect(sheet).toBeHidden();
});

test.afterEach(async () => {
  releaseBytes();
  await page().unroute(byteFetches);
});
