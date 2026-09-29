import { readFileSync } from 'node:fs';
import {
  expect,
  test,
  type BrowserContextOptions,
  type FrameLocator,
  type Locator,
  type Page,
} from '@playwright/test';

/** The emulator seed user (scripts/seed.mjs). */
export const SEED_USER = { uid: 'seed-test-user', email: 'test-user@test.com', password: 'test1234' } as const;

const repoFile = (path: string) => new URL(`../../${path}`, import.meta.url);

/** Seeded fixture PDFs (scripts/fixtures). */
export const seededPdf = (name: string): Buffer => readFileSync(repoFile(`scripts/fixtures/${name}`));

/** A fixture Extraction's content as the Guest's fake provider serves it (issue #30). */
interface FixtureExtraction {
  plainEnglishSummary: string;
  keyTakeaways: { text: string; importance: 'CRITICAL' | 'NORMAL' }[];
}

/** The seeded Extractions keyed by documentId — what the seed stores and the fake provider returns. */
export const seededExtraction = (documentId: string): FixtureExtraction =>
  (JSON.parse(readFileSync(repoFile('packages/bus-contract/src/fixtures/extractions.json'), 'utf8')) as
    Record<string, FixtureExtraction>)[documentId]!;

/** The fake provider's answer for Documents outside the seed set: the golden Bus fixture. */
export const goldenExtraction = (): FixtureExtraction =>
  (JSON.parse(
    readFileSync(repoFile('packages/bus-contract/src/fixtures/ai-processing-success.json'), 'utf8'),
  ) as { payload: { extraction: FixtureExtraction } }).payload.extraction;

/** A per-run suffix so names created by one run never collide with another's. */
export const unique = (label: string): string => `${label} ${Date.now().toString(36)}`;

/** Signs in through the real Email/Password form and waits for the library. */
export async function signIn(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByPlaceholder('Email').fill(SEED_USER.email);
  await page.getByPlaceholder('Password').fill(SEED_USER.password);
  await page.getByRole('button', { name: 'Sign in with email' }).click();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
}

/**
 * One signed-in page shared by every test in the file — sign-in happens once
 * per file (issue #34). Call at the top of a spec file; the specs in that file
 * run serially against the returned page.
 */
export function signedInPage(contextOptions?: BrowserContextOptions): () => Page {
  let page: Page;
  test.describe.configure({ mode: 'serial' });
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage(contextOptions);
    await signIn(page);
  });
  test.afterAll(async () => {
    await page.close();
  });
  return () => page;
}

/** The Guest insights panel, only ever reached through the Host's iframe. */
export const guestPanel = (page: Page): FrameLocator =>
  page.frameLocator('iframe[title="Klartext insights panel"]');

/** Opens the root Folder ("Documents") in the library. */
export async function browseRoot(page: Page): Promise<void> {
  await page.goto('/folder/root');
  await expect(page.getByRole('heading', { level: 1, name: 'Documents' })).toBeVisible();
}

/** A Host toast by (part of) its text. */
export const toast = (page: Page, text: string): Locator =>
  page.getByRole('status').filter({ hasText: text });

/**
 * The shared mobile check (issue #47): nothing side-scrolls — not the page,
 * and not any inner container (e.g. `.library-drop` computes
 * `overflow-x: auto`, so a too-wide row would scroll inside it without ever
 * growing `documentElement`). Reports the offending elements on failure.
 * Elements that clip (`overflow-x: hidden/clip`, like an ellipsized title)
 * are excluded — they truncate, not scroll.
 */
export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const offenders = await page.evaluate(() => {
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('*')) {
      const { overflowX } = getComputedStyle(el);
      if (overflowX === 'hidden' || overflowX === 'clip') continue;
      if (el.scrollWidth - el.clientWidth > 1) {
        out.push(
          `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}` +
            `${el.className ? `.${String(el.className).trim().split(/\s+/).join('.')}` : ''}`,
        );
      }
    }
    return out;
  });
  expect(offenders).toEqual([]);
}

/**
 * The companion mobile check (issues #47/#48): an element that must be
 * on-screen fits inside the viewport's left and right edges — a bounding
 * box fully within them, not merely intersecting.
 */
export async function expectInsideViewport(page: Page, locator: Locator): Promise<void> {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
}

/** A tile in the library grid by its visible name. */
export const tile = (page: Page, name: string): Locator =>
  page.locator('app-document-tile, app-folder-tile').filter({
    has: page.locator('.tile-name', { hasText: new RegExp(`^${escapeRegExp(name)}$`) }),
  });

/** Picks a ⋮ menu action on a tile. */
export async function tileAction(page: Page, name: string, action: string): Promise<void> {
  await page.getByRole('button', { name: `More actions for ${name}`, exact: true }).click();
  await page.getByRole('menuitem', { name: action }).click();
}

/**
 * Uploads PDFs through the toolbar's Upload dialog into the browsed Folder.
 * Desktop shows a labeled **Upload** button; on phone widths the round **+**
 * affordance opens the add menu that offers **Upload document** (issue #59).
 */
export async function uploadViaDialog(
  page: Page,
  files: { name: string; buffer: Buffer }[],
): Promise<void> {
  const uploadButton = page.getByRole('button', { name: /^Upload( document)?$/ });
  if (await uploadButton.isVisible()) {
    await uploadButton.click();
  } else {
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Upload document' }).click();
  }
  const dialog = page.getByRole('dialog', { name: 'Upload documents' });
  await dialog
    .locator('input[type="file"]')
    .setInputFiles(files.map((f) => ({ ...f, mimeType: 'application/pdf' })));
  await expect(dialog).toBeHidden();
}

/** Creates a Folder in the browsed Folder through the toolbar's New folder dialog. */
export async function createFolder(page: Page, name: string): Promise<void> {
  const pill = page.locator('.library-toolbar').getByRole('button', { name: 'New folder' });
  if (await pill.isVisible()) {
    await pill.click();
  } else {
    // Phone widths: the + affordance opens the add menu first (issue #59).
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('menuitem', { name: 'New folder' }).click();
  }
  const dialog = page.getByRole('dialog', { name: 'New folder' });
  await dialog.getByTestId('folder-name-input').fill(name);
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(tile(page, name)).toBeVisible();
}

/** Drops a file onto an element the way a desktop drag-and-drop does. */
export async function dropFile(target: Locator, file: { name: string; buffer: Buffer }): Promise<void> {
  const dataTransfer = await target.page().evaluateHandle(
    ({ name, base64 }) => {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], name, { type: 'application/pdf' }));
      return transfer;
    },
    { name: file.name, base64: file.buffer.toString('base64') },
  );
  await target.dispatchEvent('dragenter', { dataTransfer });
  await target.dispatchEvent('dragover', { dataTransfer });
  await target.dispatchEvent('drop', { dataTransfer });
}

/**
 * A minimal valid PDF with one page per label — the seeded fixtures are all
 * single-page, and paging needs more.
 */
export function makePdf(labels: string[]): Buffer {
  const objects: string[] = [];
  const pageIds = labels.map((_, i) => 4 + i * 2);
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${labels.length} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  labels.forEach((label, i) => {
    const content = `BT /F1 36 Tf 72 700 Td (${label.replace(/[()\\]/g, '')}) Tj ET`;
    objects[pageIds[i]!] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageIds[i]! + 1} 0 R >>`;
    objects[pageIds[i]! + 1] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  });
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = body.length;
    body += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = body.length;
  body += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) body += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
