import { readFileSync } from 'node:fs';
import { devices, expect, test } from '@playwright/test';
import {
  browseRoot,
  expectInsideViewport,
  expectNoHorizontalOverflow,
  guestPanel,
  signIn,
  signedInPage,
} from './support';

const page = signedInPage();

// Journey (issue #122): an Action Item's "Add reminder" in the Guest panel
// sends GUEST_CREATE_REMINDER over the Bus; the Host's Reminder dialog asks
// the notice anchor, derives the "must be received by" deadline, and
// exports a .ics — plus a Google Calendar link, without any Google sign-in.
test('a Guest Action Item exports a notice-period reminder as .ics', async () => {
  await page().goto('/folder/wohnung/doc/doc-mietvertrag');
  const panel = guestPanel(page());
  await expect(panel.getByRole('heading', { name: 'Tenancy agreement' })).toBeVisible();

  const row = panel.locator('li', { hasText: "three months' notice" });
  await row.getByRole('button', { name: 'Add reminder' }).click();

  const dialog = page().getByRole('dialog', { name: 'Add reminder' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("three months' notice");
  await expect(dialog).toContainText('Mietvertrag 2024');
  await expect(dialog).toContainText('Notice must be received by');

  // NOTICE_PERIOD: the user gives the anchor; the Host derives the deadline.
  await dialog.getByTestId('reminder-anchor').fill('2026-10-31');
  await expect(dialog.getByTestId('reminder-deadline')).toHaveValue('2026-07-31');
  // …which stays editable — and a fresh anchor re-derives it.
  await dialog.getByTestId('reminder-deadline').fill('2026-08-01');
  await dialog.getByTestId('reminder-anchor').fill('2026-10-30');
  await expect(dialog.getByTestId('reminder-deadline')).toHaveValue('2026-07-30');
  await dialog.getByTestId('reminder-anchor').fill('2026-10-31');

  const google = dialog.getByTestId('reminder-google');
  await expect(google).toHaveAttribute('href', /calendar\.google\.com\/calendar\/render\?/);
  await expect(google).toHaveAttribute('href', /dates=20260731%2F20260801/);

  const [download] = await Promise.all([
    page().waitForEvent('download'),
    dialog.getByTestId('reminder-ics').click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^doc-mietvertrag-.+\.ics$/);
  // Folded content lines re-join by dropping CRLF + the leading space.
  const ics = readFileSync(await download.path()!, 'utf8').replaceAll('\r\n ', '');
  expect(ics).toContain('BEGIN:VCALENDAR');
  expect(ics).toContain('VERSION:2.0');
  expect(ics).toContain('DTSTART;VALUE=DATE:20260731');
  expect(ics).toContain('DTEND;VALUE=DATE:20260801');
  expect(ics).toContain('TRIGGER:-P7D');
  expect(ics).toContain('UID:doc-mietvertrag-');
  expect(ics).toContain(
    "SUMMARY:[Klartext] To move out you must give three months' notice. — Mietvertrag 2024",
  );
  expect(ics).toContain(
    'Open in Klartext: http://localhost:5050/doc/doc-mietvertrag?page=3&item=',
  );

  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
});

// Journey: the Folder attention overview's own "Add reminder" affordance
// lands on the same dialog — no Bus involved. A past FIXED_DATE warns but
// still exports.
test('an attention row’s Add reminder opens the dialog with a past-date warning', async () => {
  await browseRoot(page());
  const overview = page().getByRole('region', { name: 'Needs your attention' });
  await expect(overview).toBeVisible();

  // The tax-office Document's Extraction job finishes after load — its
  // dated item (2024-07-31) leads the card as Overdue once it lands.
  const row = overview
    .locator('.attention-row')
    .filter({ hasText: 'File your 2023 tax return' });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Add reminder' }).click();

  const dialog = page().getByRole('dialog', { name: 'Add reminder' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('File your 2023 tax return');
  await expect(dialog).toContainText('Brief vom Finanzamt');

  // FIXED_DATE pins the deadline as text — there is no date field to edit…
  await expect(dialog.getByTestId('reminder-date')).toHaveCount(0);
  await expect(dialog).toContainText('31 July 2024');
  // …and a past deadline warns while still allowing the export.
  await expect(dialog).toContainText('in the past');
  await expect(dialog.getByTestId('reminder-ics')).toBeEnabled();
  await expect(dialog.getByTestId('reminder-google')).toHaveAttribute(
    'href',
    /dates=20240731%2F20240801/,
  );

  // The alarm picker offers the decided offsets (none / 1 / 7 / 30 days).
  const alarm = dialog.getByTestId('reminder-alarm');
  await expect(alarm.locator('option')).toHaveText([
    'No reminder',
    '1 day before',
    '7 days before',
    '30 days before',
  ]);
  await expect(alarm).toHaveValue('7');

  await page().keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

// Journey: the deep link the .ics carries — the Folder-independent
// `/doc/<id>` form resolves the Document's Folder, rewrites to the
// canonical URL with ?page&item intact, and lands the cited page.
test('a Reminder deep link opens the Document at the cited page', async () => {
  await page().goto('/doc/doc-mietvertrag?page=3&item=ai_deep');
  await expect(page()).toHaveURL(
    /\/folder\/wohnung\/doc\/doc-mietvertrag\?page=3&item=ai_deep/,
  );
  await expect(page().locator('.pdf-pageno')).toHaveText('3 / 4');
  await expect(page().getByRole('img', { name: 'Page 3 of 4' })).toBeVisible();
});

// Journey: the same dialog on a phone — a full-screen sheet whose three
// footer actions stack to full width instead of overflowing a narrow row.
test('the Reminder dialog fills a phone — footer actions stack inside the viewport', async ({
  browser,
}) => {
  const mobile = await browser.newPage({ ...devices['iPhone 13'] });
  try {
    await signIn(mobile);
    await mobile.goto('/folder/wohnung/doc/doc-mietvertrag');
    await mobile.getByRole('button', { name: 'Expand insights panel', exact: true }).tap();
    await mobile
      .getByRole('button', { name: 'Expand insights panel to full screen' })
      .tap();

    const panel = guestPanel(mobile);
    await expect(panel.getByRole('heading', { name: 'Tenancy agreement' })).toBeVisible();
    await panel
      .locator('li', { hasText: "three months' notice" })
      .getByRole('button', { name: 'Add reminder' })
      .tap();

    const dialog = mobile.getByRole('dialog', { name: 'Add reminder' });
    await expect(dialog).toBeVisible();
    // The Google link only renders once a date exists — anchor the notice.
    await dialog.getByTestId('reminder-anchor').fill('2026-10-31');
    await expect(dialog.getByTestId('reminder-deadline')).toHaveValue('2026-07-31');
    await expectInsideViewport(mobile, dialog);
    // The sheet covers the viewport, not just part of it.
    const box = await dialog.boundingBox();
    expect(box!.height).toBeGreaterThan(mobile.viewportSize()!.height * 0.95);
    for (const name of ['Cancel', 'Google Calendar', 'Download .ics']) {
      await expectInsideViewport(
        mobile,
        dialog.getByRole('button', { name }).or(dialog.getByRole('link', { name })),
      );
    }
    // The footer stacks — the actions take the sheet's full width.
    await expect
      .poll(() => dialog.locator('.dialog-foot').evaluate((el) => getComputedStyle(el).flexDirection))
      .toBe('column');
    await expectNoHorizontalOverflow(mobile);
  } finally {
    await mobile.close();
  }
});
