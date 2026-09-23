/**
 * Loading a batch and getting files out of it, in a real browser.
 *
 * This is the path that matters most: if someone can drop a PDF in and get
 * correctly named invoices back, the app works. Everything here uses the
 * synthetic sample PDFs, so no real invoice ever goes near a test.
 */

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, '..', 'fixtures', 'pdf');

const fixture = (name) => join(FIXTURES, name);

/** Load one or more sample PDFs into the app and wait for the split to appear. */
async function loadFixtures(page, names) {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(names.map(fixture));
  await expect(page.getByTestId('page-strip')).toBeVisible();
}

/** Click something that downloads, and hand back the saved file. */
async function download(page, action) {
  const waitFor = page.waitForEvent('download');
  await action();
  const saved = await waitFor;
  return { name: saved.suggestedFilename(), path: await saved.path() };
}

test('splits a batch and says where every number came from', async ({ page }) => {
  await loadFixtures(page, ['01-same-line.pdf', '05-repeat-later.pdf']);

  // Two pages of one invoice, then three separate ones. Two of those three
  // carry the same number, so both are worth a look before exporting.
  await expect(page.getByTestId('summary')).toHaveText(
    '5 pages split into 4 invoices, 2 worth a look.'
  );

  const table = page.getByTestId('invoice-table');
  await expect(table.getByRole('row')).toHaveCount(5); // a header row and four invoices
  await expect(table.getByRole('rowheader', { name: '104233' })).toBeVisible();
  await expect(table.getByText('Invoice #:').first()).toBeVisible();
  await expect(table.getByText('an everyday label').first()).toBeVisible();

  // Both invoices numbered INV-2001 are kept, under names that do not collide.
  await expect(table.getByText('INV-2001.pdf')).toBeVisible();
  await expect(table.getByText('INV-2001 (2).pdf')).toBeVisible();
});

test('shows the file name pattern working before anything is exported', async ({ page }) => {
  await loadFixtures(page, ['01-same-line.pdf']);

  await expect(page.getByTestId('name-example')).toContainText('104233_PO-9921.pdf');

  await page.getByLabel('Start every name with').fill('Northwind ');
  await expect(page.getByTestId('name-example')).toContainText('Northwind 104233_PO-9921.pdf');
});

test('exports one invoice with the right pages in it', async ({ page }) => {
  await loadFixtures(page, ['03-repeated-number.pdf']);

  await expect(page.getByTestId('summary')).toHaveText('3 pages split into 1 invoice.');

  const saved = await download(page, () =>
    page.getByTestId('invoice-table').getByRole('button', { name: 'Download' }).click()
  );

  expect(saved.name).toBe('100777.pdf');
  const pdf = await PDFDocument.load(await readFile(saved.path));
  expect(pdf.getPageCount()).toBe(3);
});

test('exports a ZIP holding every invoice under its own name', async ({ page }) => {
  await loadFixtures(page, ['05-repeat-later.pdf']);

  const saved = await download(page, () => page.getByTestId('download-zip').click());

  expect(saved.name).toBe('invoices.zip');
  const zip = await JSZip.loadAsync(await readFile(saved.path));
  expect(Object.keys(zip.files).sort()).toEqual([
    'INV-2001 (2).pdf',
    'INV-2001.pdf',
    'INV-2002.pdf',
  ]);

  // The files inside are real PDFs, one page each.
  const first = await PDFDocument.load(await zip.file('INV-2002.pdf').async('uint8array'));
  expect(first.getPageCount()).toBe(1);
});

test('exports a page map Excel can open', async ({ page }) => {
  await loadFixtures(page, ['01-same-line.pdf']);

  const saved = await download(page, () => page.getByTestId('download-csv').click());
  const csv = await readFile(saved.path, 'utf8');

  expect(saved.name).toBe('page-map.csv');
  expect(csv.charCodeAt(0)).toBe(0xfeff); // the byte order mark Excel needs
  expect(csv).toContain('Invoice,Extra,Found after,Pages,Page count,File name,Source file(s)');
  expect(csv).toContain('104233,,Invoice #:,1 to 2,2,104233.pdf,01-same-line.pdf');
});

test('opens a page, shows its text, and steps through the batch', async ({ page }) => {
  await loadFixtures(page, ['01-same-line.pdf']);

  await page.getByTestId('tile-1').click();
  const modal = page.getByTestId('preview-modal');

  await expect(modal).toBeVisible();
  await expect(modal.getByRole('heading', { name: 'Page 1' })).toBeVisible();
  await expect(modal.getByText('found after')).toBeVisible();
  await expect(page.getByTestId('page-text')).toContainText('Invoice #: 104233');

  // The text layer sits on top of the drawn page, ready to select.
  await expect(modal.locator('.textLayer span').first()).toBeAttached();

  await page.keyboard.press('ArrowRight');
  await expect(modal.getByRole('heading', { name: 'Page 2' })).toBeVisible();
  await expect(page.getByTestId('page-text')).toContainText('Delivery notes');

  await page.keyboard.press('Escape');
  await expect(modal).toBeHidden();
});

test('changing a setting re-splits the batch without re-reading the file', async ({ page }) => {
  await loadFixtures(page, ['04-remittance-slip.pdf']);

  await expect(page.getByTestId('summary')).toHaveText('2 pages split into 1 invoice.');

  await page.getByRole('radio', { name: /Set aside for me to look at/ }).check();

  await expect(page.getByTestId('summary')).toHaveText(
    '2 pages split into 2 invoices, 1 worth a look.'
  );
  await expect(page.getByTestId('invoice-table').getByText('NO-NUMBER_p2.pdf')).toBeVisible();
});

test('search narrows the table and dims the pages that do not match', async ({ page }) => {
  await loadFixtures(page, ['05-repeat-later.pdf']);

  await page.getByTestId('search').fill('INV-2002');

  const rows = page.getByTestId('invoice-table').getByRole('row');
  await expect(rows).toHaveCount(2); // the header, and the one match
  await expect(page.getByTestId('tile-2')).not.toHaveClass(/tile-dimmed/);
  await expect(page.getByTestId('tile-1')).toHaveClass(/tile-dimmed/);
});

test('says plainly that a password-protected file cannot be opened', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(fixture('15-password-protected.pdf'));

  await expect(page.getByTestId('problems')).toContainText('This PDF is password-protected.');
  await expect(page.getByTestId('problems')).toContainText('Save a copy without the password');
});

test('makes no network request while a batch is being worked on', async ({ page }) => {
  const requests = [];
  page.on('request', (request) => requests.push(request.url()));

  await loadFixtures(page, ['01-same-line.pdf']);
  const afterLoad = requests.length;

  await page.getByTestId('search').fill('104233');
  await page.getByTestId('tile-1').click();
  await expect(page.getByTestId('page-text')).toBeVisible();
  await page.keyboard.press('Escape');
  await download(page, () => page.getByTestId('download-csv').click());

  // Everything after the app's own files loaded happened on this machine.
  expect(requests.slice(afterLoad)).toEqual([]);
  expect(requests.every((url) => url.startsWith('http://127.0.0.1:4173'))).toBe(true);
});
