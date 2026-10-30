import { devices, expect, test } from '@playwright/test';
import { animationsSettled, browseRoot, signedInPage } from './support';

// Journey (issue #153, ADR 0014): on a phone the attention "See All" sheet
// is a real modal sheet on the shared Sheet primitive — it opens at the
// medium detent, the grabber tap grows it to large, and a grabber swipe
// down closes it. The sheet chrome has no "Done" — that's the Action Item
// state, not a close affordance.
const page = signedInPage({ ...devices['iPhone 13'] });

const sheet = () => page().getByRole('dialog', { name: 'Needs your attention' });
const grabber = () => sheet().locator('.sheet-handle');

test('the See All sheet rests at medium, taps to large, and swipes down to close', async () => {
  await browseRoot(page());
  await page()
    .getByRole('region', { name: 'Needs your attention' })
    .getByRole('button', { name: 'See All' })
    .tap();

  // Opens at medium — about half the viewport.
  await expect(sheet()).toBeVisible();
  await expect(sheet()).toHaveAttribute('data-sheet', 'medium');
  await expect(grabber()).toHaveAttribute('aria-expanded', 'false');
  await expect(grabber()).toHaveAccessibleName('Expand');

  // The detents resolve against the CSS viewport, which the emulated
  // browser chrome shrinks below the device's viewportSize.
  const vh = await page().evaluate(() => window.innerHeight);
  const box = (await sheet().boundingBox())!;
  expect(box.height).toBeGreaterThan(vh * 0.4);
  expect(box.height).toBeLessThan(vh * 0.6);

  // Grabber tap → large fills the viewport; a second tap returns to medium.
  await grabber().tap();
  await expect(sheet()).toHaveAttribute('data-sheet', 'large');
  await expect(grabber()).toHaveAttribute('aria-expanded', 'true');
  await expect(grabber()).toHaveAccessibleName('Collapse');

  await grabber().tap();
  await expect(sheet()).toHaveAttribute('data-sheet', 'medium');
  await expect(grabber()).toHaveAttribute('aria-expanded', 'false');

  // A swipe down on the grabber closes the sheet — measured once the
  // settle lands, so the press can't land beside the still-moving handle.
  await animationsSettled(page(), '.sheet');
  const handle = (await grabber().boundingBox())!;
  await page().mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page().mouse.down();
  await page().mouse.move(handle.x + handle.width / 2, vh * 0.95, { steps: 12 });
  // Pause before the release so the settle is a snap-to-nearest, not a flick.
  await page().waitForTimeout(200);
  await page().mouse.up();
  await expect(sheet()).toBeHidden();
});
