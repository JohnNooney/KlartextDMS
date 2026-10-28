import { devices, expect, test } from '@playwright/test';
import { guestPanel, seededExtraction, signedInPage } from './support';

// Journey (issue #77): in the desktop lane the Guest shows a slim outline
// rail on its trailing edge — one icon button per section with count
// badges. Clicking a button scrolls the panel to the section and the rail's
// scroll-spy marks it current. In the mobile sheet no rail is rendered.
test.describe('desktop lane', () => {
  const page = signedInPage();

  test('the outline rail navigates the panel sections', async () => {
    await page().goto('/folder/wohnung/doc/doc-mietvertrag');
    const panel = guestPanel(page());
    await expect(
      panel.getByRole('heading', { level: 1, name: 'Tenancy agreement' }),
    ).toBeVisible();

    const rail = panel.getByRole('navigation', { name: 'Insights outline' });
    await expect(rail).toBeVisible();

    // Count badges mirror the section contents; the summary has none.
    const fixture = seededExtraction('doc-mietvertrag');
    const critical = fixture.actionItems.length;
    const normal = fixture.keyTakeaways.length;
    const attention = rail.getByRole('button', { name: 'Needs your attention' });
    const takeaways = rail.getByRole('button', { name: 'Key takeaways' });
    await expect(attention).toHaveText(String(critical));
    await expect(takeaways).toHaveText(String(normal));

    // Clicking a rail button scrolls its section into view and the spy marks it.
    await takeaways.click();
    await expect(panel.locator('[data-section="takeaways"]')).toBeInViewport();
    await expect(takeaways).toHaveAttribute('aria-current', 'location');
  });
});

test.describe('mobile sheet', () => {
  const page = signedInPage({ ...devices['iPhone 13'] });

  test('the sheet presentation renders no outline rail', async () => {
    await page().goto('/folder/wohnung/doc/doc-mietvertrag');
    // Expand the sheet so the panel's content is on-screen.
    await page()
      .getByRole('button', { name: 'Expand insights panel', exact: true })
      .tap();
    const panel = guestPanel(page());
    await expect(
      panel.getByRole('heading', { level: 1, name: 'Tenancy agreement' }),
    ).toBeVisible();
    await expect(panel.getByRole('navigation', { name: 'Insights outline' })).toBeHidden();
  });
});
