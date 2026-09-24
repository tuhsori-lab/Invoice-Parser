/**
 * Long batches, and pages that are only a picture.
 *
 * Both of these are where a tool like this usually gives up: hundreds of
 * invoices make the table crawl, and a scanned page has nothing to read at all.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, '..', 'fixtures', 'pdf');

const fixture = (name) => join(FIXTURES, name);

async function loadFixtures(page, names) {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(names.map(fixture));
  await expect(page.getByTestId('page-strip')).toBeVisible();
}

test('draws only the rows in view once a batch gets long', async ({ page }) => {
  await loadFixtures(page, ['19-long-batch.pdf']);

  await expect(page.getByTestId('summary')).toHaveText('220 pages split into 210 invoices.');

  const table = page.getByTestId('invoice-table');
  const rows = table.locator('tbody tr:not(.spacer)');

  // Two hundred and ten invoices, nothing like that many rows in the document.
  const drawn = await rows.count();
  expect(drawn).toBeGreaterThan(5);
  expect(drawn).toBeLessThan(80);

  // The first invoice is drawn; one far down the list is not, yet.
  await expect(table.getByRole('rowheader', { name: '200000' })).toBeVisible();
  await expect(table.getByRole('rowheader', { name: '200209' })).toHaveCount(0);

  // Scrolling to the end brings the last invoices in and lets the first go.
  await page.getByTestId('table-scroller').evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(table.getByRole('rowheader', { name: '200209' })).toBeVisible();
  await expect(table.getByRole('rowheader', { name: '200000' })).toHaveCount(0);
});

test('stays usable on a long batch: search, fix, and export', async ({ page }) => {
  await loadFixtures(page, ['19-long-batch.pdf']);

  // Search finds one invoice among two hundred without scrolling for it.
  await page.getByTestId('search').fill('200100');
  const rows = page.getByTestId('invoice-table').locator('tbody tr:not(.spacer)');
  await expect(rows).toHaveCount(1);

  await page.getByTestId('search').fill('');
  await expect(page.getByTestId('summary')).toHaveText('220 pages split into 210 invoices.');

  // A fix still lands, and undo still takes it back. Pages 1 and 2 are one
  // invoice; splitting between them makes two.
  await page.getByTestId('gap-2').click();
  await expect(page.getByTestId('summary')).toContainText('211 invoices');
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('summary')).toHaveText('220 pages split into 210 invoices.');

  // And the page map still comes out.
  const waitFor = page.waitForEvent('download');
  await page.getByTestId('download-csv').click();
  expect((await waitFor).suggestedFilename()).toBe('page-map.csv');
});

test('offers to read a page that is only a picture, and flags what it read', async ({ page }) => {
  const offsite = [];
  page.on('request', (request) => {
    const url = request.url();
    if (!url.startsWith('http://127.0.0.1:4173') && !url.startsWith('blob:')) offsite.push(url);
  });

  await loadFixtures(page, ['16-image-only.pdf']);

  const notice = page.getByTestId('scanned-notice');
  await expect(notice).toContainText('One page has no readable text on it');

  await page.getByTestId('read-scanned').click();
  await expect(page.getByTestId('stop-reading')).toBeVisible();

  // Reading is slow, so it gets its own patience.
  await expect(page.getByTestId('scanned-notice')).toHaveCount(0, { timeout: 120_000 });

  // The page now has words on it, and its invoice says where they came from.
  await page.getByTestId('tile-1').click();
  await expect(page.getByTestId('page-text')).toContainText('SOUTHRIDGE');
  await page.keyboard.press('Escape');

  await expect(page.getByTestId('invoice-table')).toContainText(
    'Text was read from a scan, so it may be wrong'
  );
  await expect(page.getByTestId('review-queue')).toContainText('was read from a scan');

  // Text recognition is served by this app, not fetched from anyone else.
  expect(offsite).toEqual([]);
});

test('a number typed by hand settles a scan that could not be read', async ({ page }) => {
  await loadFixtures(page, ['16-image-only.pdf']);

  await page.getByTestId('read-scanned').click();
  await expect(page.getByTestId('scanned-notice')).toHaveCount(0, { timeout: 120_000 });

  await page.getByTestId('invoice-value-g1').click();
  await page.getByTestId('invoice-input-g1').fill('552211');
  await page.keyboard.press('Enter');

  await expect(page.getByTestId('invoice-table')).toContainText('552211.pdf');
  // Still flagged: the text came from a scan, whatever was typed over it.
  await expect(page.getByTestId('review-queue')).toContainText('was read from a scan');
});
