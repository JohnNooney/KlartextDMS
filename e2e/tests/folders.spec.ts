import { expect, test } from '@playwright/test';
import {
  browseRoot,
  createFolder,
  seededPdf,
  signedInPage,
  toast,
  tile,
  tileAction,
  unique,
  uploadViaDialog,
} from './support';

const page = signedInPage();

// Journey: create a Folder, nest one inside it, then move the nested Folder.
test('Folders can be created, nested and moved', async () => {
  const parent = unique('E2E Parent');
  const child = unique('E2E Child');
  const destination = unique('E2E Destination');
  await browseRoot(page());

  await createFolder(page(), parent);
  await createFolder(page(), destination);

  await tile(page(), parent).click();
  await expect(page().getByRole('heading', { level: 1, name: parent })).toBeVisible();
  await createFolder(page(), child);

  await tileAction(page(), child, 'Move to…');
  const dialog = page().getByRole('dialog', { name: `Move “${child}”` });
  await dialog.getByRole('option', { name: destination }).click();
  await dialog.getByRole('button', { name: 'Move' }).click();

  await expect(tile(page(), child)).toBeHidden();
  await browseRoot(page());
  await expect(tile(page(), parent).getByTestId('folder-count')).toHaveText('0 documents');
  await expect(tile(page(), destination).getByTestId('folder-count')).toHaveText('0 documents');
  await tile(page(), destination).click();
  await expect(tile(page(), child)).toBeVisible();
});

// Journey: deleting a Folder takes its sub-Folders and Documents with it.
test('deleting a Folder removes everything inside it', async () => {
  const outer = unique('E2E Doomed');
  const inner = unique('E2E Doomed inner');
  const doc = unique('E2E Doomed doc');
  await browseRoot(page());
  await createFolder(page(), outer);
  await tile(page(), outer).click();
  await createFolder(page(), inner);
  await tile(page(), inner).click();
  await uploadViaDialog(page(), [{ name: `${doc}.pdf`, buffer: seededPdf('brief-finanzamt.pdf') }]);
  await expect(toast(page(), `Uploaded ${doc}.pdf`)).toBeVisible();

  await browseRoot(page());
  await expect(tile(page(), outer).getByTestId('folder-count')).toHaveText('1 document');
  await tileAction(page(), outer, 'Delete');
  const confirm = page().getByRole('alertdialog', { name: 'Delete folder' });
  await expect(confirm.getByTestId('folder-delete-contents')).toContainText('1 document in 1 folder');
  await confirm.getByRole('button', { name: 'Delete' }).click();

  await expect(toast(page(), `Deleted ${outer}`)).toBeVisible();
  await expect(tile(page(), outer)).toBeHidden();
  await expect(page().getByRole('treeitem', { name: outer })).toBeHidden();

  // Gone after a reload too — the teardown reached the database, not just the view.
  await page().reload();
  await expect(page().getByRole('heading', { level: 1, name: 'Documents' })).toBeVisible();
  await expect(page().getByRole('treeitem', { name: 'Verträge' })).toBeVisible();
  await expect(page().getByRole('treeitem', { name: outer })).toBeHidden();
});
