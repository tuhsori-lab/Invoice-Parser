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

  // Every page in this file is a scan, so the notice says so in full.
  const notice = page.getByTestId('scanned-notice');
  await expect(notice).toContainText(
    'No readable text was found. These look like scanned pages. Turn on text recognition to read them.'
  );

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

test('reads scanned pages that have a note typed on top, and a box drawn on one of them', async ({
  page,
}) => {
  // Three pages of text recognition, some of them read twice.
  test.setTimeout(300_000);
  await loadFixtures(page, ['23-scanned-with-notes.pdf']);

  // Each page has words on it - the typed note - but they are not the ones on
  // the paper. The app sees the pages are pictures and offers to read them.
  const notice = page.getByTestId('scanned-notice');
  await expect(notice).toContainText(
    '3 pages look like scans, so their invoice numbers could not be read.'
  );
  // Until then a box on them would find nothing, so the app does not ask for one.
  await expect(page.getByTestId('point-prompt')).toHaveCount(0);

  await page.getByTestId('read-scanned').click();
  await expect(notice).toHaveCount(0, { timeout: 240_000 });

  // Numbered by year and ledger, slashes and all, and the credit note is read by
  // its own number rather than the invoice it mentions.
  await expect(page.getByTestId('summary')).toContainText('3 pages split into 2 invoices');
  const table = page.getByTestId('invoice-table');
  await expect(table).toContainText('2031-TB-00412.pdf');
  await expect(table).toContainText('2031-TB-00587.pdf');
  await expect(table).toContainText('1 to 2');

  // Now a box can be drawn on a scan: around the number, by where it sits.
  await page.getByTestId('point-prompt-go').click();
  const sheet = await page.getByTestId('spot-picker').boundingBox();
  await page.mouse.move(sheet.x + sheet.width * 0.725, sheet.y + sheet.height * 0.192);
  await page.mouse.down();
  await page.mouse.move(sheet.x + sheet.width * 0.885, sheet.y + sheet.height * 0.214, {
    steps: 6,
  });
  await page.mouse.up();
  await expect(page.getByTestId('spot-value')).toHaveText('2031/TB/00412');
  // Named after the supplier's letterhead as it recurs across the batch, not a
  // logo or whatever recognition made of the first line.
  await expect(page.getByTestId('spot-client')).toHaveText('VALLOMBROSA TESSUTI SPA');
  await page.getByTestId('spot-save').click();
  await expect(page.getByTestId('teach-result')).toContainText('2 invoices in this batch');
  await page.getByRole('button', { name: 'Done' }).click();

  await expect(table).toContainText('2031-TB-00412.pdf');
  await expect(table).toContainText('2031-TB-00587.pdf');
  await expect(table.getByText('the spot you chose')).toHaveCount(2);
});
