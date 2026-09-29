import { devices, expect, test, type Page } from '@playwright/test';
import { guestPanel, signedInPage } from './support';

// Journey (issue #49): on a phone-sized viewport the insights sheet's grab
// handle lives in its own strip — the chevron points where the sheet will
// move, and no Guest content hides under it.
const page = signedInPage({ ...devices['iPhone 13'] });

/** The handle strip shares no pixels with the iframe it sits above — one
 *  evaluate so the two rects come from the same layout frame while the
 *  sheet's height transition is animating. */
async function expectNoOverlap(page: Page): Promise<void> {
  const boxes = await page.evaluate(() => {
    const handle = document.querySelector('.sheet-handle')!.getBoundingClientRect();
    const frame = document.querySelector('iframe.guest-frame')!.getBoundingClientRect();
    return { handleBottom: handle.bottom, handleHeight: handle.height, frameTop: frame.top };
  });
  // --kt-touch-target (packages/theme/tokens.css) is the >=44px AC.
  expect(boxes.handleHeight).toBeGreaterThanOrEqual(44);
  expect(boxes.handleBottom).toBeLessThanOrEqual(boxes.frameTop + 0.5);
}

test('the handle strip points where the sheet will move and never covers the Guest', async () => {
  await page().goto('/folder/wohnung/doc/doc-mietvertrag');

  const frame = page().locator('iframe[title="Klartext insights panel"]');
  const expand = page().getByRole('button', { name: 'Expand insights panel' });
  await expect(frame).toBeVisible();
  await expect(expand).toBeVisible();
  await expect(expand).toHaveAttribute('aria-expanded', 'false');
  await expectNoOverlap(page());

  await expand.tap();

  const collapse = page().getByRole('button', { name: 'Collapse insights panel' });
  await expect(collapse).toHaveAttribute('aria-expanded', 'true');
  await expectNoOverlap(page());
  await expect(guestPanel(page()).getByRole('heading', { name: 'Mietvertrag 2024' })).toBeVisible();

  await collapse.tap();
  await expect(page().getByRole('button', { name: 'Expand insights panel' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
});
