import { devices, expect, test, type Page } from '@playwright/test';
import { guestPanel, seededExtraction, signedInPage } from './support';

// Journey (issue #50): on a phone-sized viewport the insights sheet rests at
// peek — the grab-handle strip plus the top of the Guest frame (its section
// jump bar, issue #79) over an unobstructed PDF — and the handle cycles it
// through peek → half → full → peek. The handle never covers Guest content
// (issue #49).
const page = signedInPage({ ...devices['iPhone 13'] });

/** The handle strip shares no pixels with the iframe it sits above — one
 *  evaluate so the two rects come from the same layout frame while the
 *  sheet's height transition is animating. */
async function expectNoOverlap(page: Page): Promise<void> {
  const boxes = await page.evaluate(() => {
    const handle = document.querySelector('.sheet-handle')!.getBoundingClientRect();
    const frame = document.querySelector('iframe.guest-frame')!.getBoundingClientRect();
    return {
      handleBottom: handle.bottom,
      handleHeight: handle.height,
      frameTop: frame.top,
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  // --kt-touch-target (packages/theme/tokens.css) is the >=44px AC.
  expect(boxes.handleHeight).toBeGreaterThanOrEqual(44);
  expect(boxes.handleBottom).toBeLessThanOrEqual(boxes.frameTop + 0.5);
  expect(boxes.overflowX).toBeLessThanOrEqual(0);
}

const sheet = () => page().locator('.guest-frame-host');
const expand = () => page().getByRole('button', { name: 'Expand insights panel', exact: true });
const expandFull = () =>
  page().getByRole('button', { name: 'Expand insights panel to full screen' });
const collapse = () => page().getByRole('button', { name: 'Collapse insights panel' });

/** Asserts the sheet's rendered height — retries while the height transition settles. */
async function expectSheetHeight(min: number, max: number): Promise<void> {
  await expect(async () => {
    const box = await sheet().boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(min);
    expect(box!.height).toBeLessThanOrEqual(max);
  }).toPass();
}

test('the sheet rests at peek and the handle cycles it through the detents', async () => {
  await page().goto('/folder/wohnung/doc/doc-mietvertrag');

  const frame = page().locator('iframe[title="Klartext insights panel"]');

  // Peek: just the chrome — the strip plus the Guest's jump bar (issue #79)
  // — so the PDF stays essentially unobstructed. The iframe stays mounted.
  await expect(sheet()).toHaveAttribute('data-sheet', 'peek');
  await expect(expand()).toBeVisible();
  await expect(expand()).toHaveAttribute('aria-expanded', 'false');
  await expect(page().locator('.sheet-head')).toHaveCount(0);
  await expect(
    guestPanel(page()).getByRole('navigation', { name: 'Jump to section' }),
  ).toBeVisible();
  await expect(frame).toBeAttached();
  await expectNoOverlap(page());
  // The 36x5 grabber pill (--kt-grabber-* tokens) is the drag affordance.
  const pill = await page().locator('.sheet-handle .handle-pill').boundingBox();
  expect(pill).not.toBeNull();
  expect(Math.round(pill!.width)).toBe(36);
  expect(Math.round(pill!.height)).toBe(5);
  // 88px: the 44px handle strip plus the 44px jump bar (the emulator has no
  // safe-area inset).
  await expectSheetHeight(84, 96);
  const viewport = page().viewportSize()!;

  // → half: about half the viewport, the Extraction readable.
  await expand().tap();
  await expect(sheet()).toHaveAttribute('data-sheet', 'half');
  await expect(expandFull()).toHaveAttribute('aria-expanded', 'true');
  await expectSheetHeight(viewport.height * 0.4, viewport.height * 0.6);
  await expectNoOverlap(page());
  await expect(guestPanel(page()).getByRole('heading', { name: 'Tenancy agreement' })).toBeVisible();

  // → full: the sheet fills the viewport.
  await expandFull().tap();
  await expect(sheet()).toHaveAttribute('data-sheet', 'full');
  await expect(collapse()).toHaveAttribute('aria-expanded', 'true');
  await expectSheetHeight(viewport.height * 0.9, viewport.height);
  await expectNoOverlap(page());
  await expect(guestPanel(page()).getByRole('heading', { name: 'Tenancy agreement' })).toBeVisible();

  // → back to peek.
  await collapse().tap();
  await expect(sheet()).toHaveAttribute('data-sheet', 'peek');
  await expect(expand()).toHaveAttribute('aria-expanded', 'false');
});

// Issue #62: the grab bar is draggable — the sheet tracks the pointer, then
// snaps to the nearest detent on release. A real drag must not also fire the
// handle's tap-to-cycle.
test('dragging the handle snaps the sheet to the nearest detent', async () => {
  await page().goto('/folder/wohnung/doc/doc-mietvertrag');
  await expect(sheet()).toHaveAttribute('data-sheet', 'peek');

  const vh = page().viewportSize()!.height;

  /** Presses the handle's centre and drags to clientY, pausing before the
   *  release so the settle is a snap-to-nearest, not a flick. */
  async function dragSheetTo(clientY: number): Promise<void> {
    const box = (await page().locator('.sheet-handle').boundingBox())!;
    await page().mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page().mouse.down();
    await page().mouse.move(box.x + box.width / 2, clientY, { steps: 12 });
    await page().waitForTimeout(200);
    await page().mouse.up();
  }

  // Up to ~55% open — nearest detent is half; the release's click is eaten.
  await dragSheetTo(vh * 0.45);
  await expect(sheet()).toHaveAttribute('data-sheet', 'half');
  await expectNoOverlap(page());
  await expectSheetHeight(vh * 0.4, vh * 0.6);

  // To the top — full — then back to the bottom — peek.
  await dragSheetTo(vh * 0.05);
  await expect(sheet()).toHaveAttribute('data-sheet', 'full');
  await dragSheetTo(vh * 0.97);
  await expect(sheet()).toHaveAttribute('data-sheet', 'peek');
  await expect(expand()).toHaveAttribute('aria-expanded', 'false');
});

// Issue #76: the sidebar toggle is a desktop affordance — on mobile the
// sheet's detents already cover show/hide, so the button is never offered.
test('the insights lane toggle stays off mobile', async () => {
  await page().goto('/folder/wohnung/doc/doc-mietvertrag');
  await expect(sheet()).toHaveAttribute('data-sheet', 'peek');
  await expect(page().getByRole('button', { name: 'Hide insights' })).toBeHidden();
});

// Issue #78: a landed GUEST_SHOW_PAGE rests the sheet at half — a tap on a
// takeaway inside the sheet navigates the PDF, which shows above the
// half-open panel, and the takeaways stay in reach.
test('selecting a Key Takeaway rests the sheet at half', async () => {
  await page().goto('/folder/wohnung/doc/doc-mietvertrag');
  await expand().tap();
  await expandFull().tap();
  await expect(sheet()).toHaveAttribute('data-sheet', 'full');
  const panel = guestPanel(page());
  await expect(panel.getByRole('heading', { name: 'Tenancy agreement' })).toBeVisible();

  // The first Critical Warning points at page 3 (seeded fixture).
  await panel.getByRole('button', { name: /three months' notice/ }).tap();

  await expect(sheet()).toHaveAttribute('data-sheet', 'half');
  await expect(page().locator('.pdf-pageno')).toHaveText('3 / 4');
});

test('opening another Document rests the sheet back at peek', async () => {
  await page().goto('/folder/kranken/doc/doc-versicherungsschein');
  await expand().tap();
  await expandFull().tap();
  await expect(sheet()).toHaveAttribute('data-sheet', 'full');

  await page().goto('/folder/wohnung/doc/doc-mietvertrag');
  await expect(sheet()).toHaveAttribute('data-sheet', 'peek');
});

// Issue #79: the jump bar is the sheet's section navigation — an HIG
// segmented control pinned at the top of the Guest's content, visible and
// tappable at every detent including peek. A tap at peek sends
// GUEST_EXPAND_PANEL (the Guest can't raise its own frame) — the sheet
// lifts to half and the section scrolls into view.
test('tapping a jump-bar segment at peek raises the sheet to its section', async () => {
  await page().goto('/folder/wohnung/doc/doc-mietvertrag');
  await expect(sheet()).toHaveAttribute('data-sheet', 'peek');

  const panel = guestPanel(page());
  const bar = panel.getByRole('navigation', { name: 'Jump to section' });
  await expect(bar).toBeVisible();

  // The attention segment carries the seeded Critical Warning count.
  const critical = seededExtraction('doc-mietvertrag').actionItems.length;
  const attention = bar.getByRole('button', { name: /^Attention/ });
  await expect(attention).toContainText(String(critical));

  // The tap is inside the peek sliver itself — it must raise the sheet.
  await attention.tap();
  await expect(sheet()).toHaveAttribute('data-sheet', 'half');
  await expect(panel.locator('[data-section="attention"]')).toBeInViewport();

  // At a raised detent a tap only scrolls — the sheet doesn't move.
  await bar.getByRole('button', { name: 'Takeaways' }).tap();
  await expect(sheet()).toHaveAttribute('data-sheet', 'half');
  await expect(panel.locator('[data-section="takeaways"]')).toBeInViewport();
  await expect(
    bar.getByRole('button', { name: 'Takeaways' }),
  ).toHaveAttribute('aria-current', 'location');
});
