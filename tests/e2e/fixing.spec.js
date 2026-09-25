/**
 * Putting right what detection got wrong.
 *
 * Detection is only ever a first guess, so the fixes have to be quick, obvious
 * and reversible. These tests drive the real interface: clicking the gaps on the
 * strip, dragging a page onto another invoice, typing a number, and taking it
 * all back again.
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

test('splits and joins an invoice by clicking the gaps on the strip', async ({ page }) => {
  await loadFixtures(page, ['03-repeated-number.pdf']);

  await expect(page.getByTestId('summary')).toHaveText('3 pages split into 1 invoice.');

  // The three pages all carry 100777, but they are really two invoices. Both
  // halves then want the same file name, which is worth saying out loud.
  await page.getByTestId('gap-3').click();
  await expect(page.getByTestId('summary')).toHaveText(
    '3 pages split into 2 invoices, 2 worth a look.'
  );
  await expect(page.getByTestId('gap-3')).toHaveClass(/gap-manual/);
  await expect(page.getByTestId('review-queue')).toContainText(
    'Another invoice has the same number'
  );

  // Clicking the same gap again puts them back together.
  await page.getByTestId('gap-3').click();
  await expect(page.getByTestId('summary')).toHaveText('3 pages split into 1 invoice.');
});

test('joins a page that detection split off on its own', async ({ page }) => {
  await loadFixtures(page, ['05-repeat-later.pdf']);

  await expect(page.getByTestId('summary')).toHaveText(
    '3 pages split into 3 invoices, 2 worth a look.'
  );

  // Page 3 is the second sheet of the invoice on page 1, not an invoice of its own.
  await page.getByTestId('gap-3').click();

  await expect(page.getByTestId('summary')).toHaveText('3 pages split into 2 invoices.');
  await expect(page.getByTestId('review-queue')).toBeHidden();
});

test('moves a page onto another invoice by dragging it', async ({ page }) => {
  await loadFixtures(page, ['05-repeat-later.pdf']);

  // Drag page 3 onto page 1, so it joins that invoice.
  await page.getByTestId('tile-3').dragTo(page.getByTestId('tile-1'));

  const rows = page.getByTestId('invoice-table').getByRole('row');
  await expect(rows).toHaveCount(3); // header, plus two invoices
  await expect(page.getByTestId('invoice-row-g1').getByRole('cell').nth(3)).toHaveText('1, 3');
  await expect(page.getByTestId('tile-3')).toHaveClass(/tile-moved/);
});

test('moves a page from the preview, without a mouse', async ({ page }) => {
  await loadFixtures(page, ['05-repeat-later.pdf']);

  await page.getByTestId('tile-2').click();
  await page.getByTestId('move-back').click();
  await page.keyboard.press('Escape');

  // Page 2 now belongs with page 1, which is invoice INV-2001.
  await expect(page.getByTestId('invoice-row-g1').getByRole('cell').nth(3)).toHaveText('1 to 2');
  await expect(page.getByTestId('invoice-row-g1').getByRole('rowheader')).toContainText('INV-2001');
});

test('corrects an invoice number in place and marks it as edited', async ({ page }) => {
  await loadFixtures(page, ['12-unusual-label.pdf']);

  await expect(page.getByTestId('review-queue')).toContainText(
    'No invoice number was found on page 1.'
  );

  await page.getByTestId('invoice-value-g1').click();
  await page.getByTestId('invoice-input-g1').fill('889900');
  await page.keyboard.press('Enter');

  await expect(page.getByTestId('invoice-value-g1')).toContainText('889900');
  await expect(page.getByTestId('invoice-value-g1')).toContainText('edited');
  await expect(page.getByTestId('invoice-table')).toContainText('889900.pdf');
  await expect(page.getByTestId('review-queue')).toBeHidden();
});

test('keeps a fix when a detection setting changes afterwards', async ({ page }) => {
  await loadFixtures(page, ['04-remittance-slip.pdf']);

  await page.getByTestId('invoice-value-g1').click();
  await page.getByTestId('invoice-input-g1').fill('CORRECTED-1');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('invoice-table')).toContainText('CORRECTED-1.pdf');

  // Changing how unnumbered pages are handled re-runs detection over the same
  // text. The number typed by hand has to survive that.
  await page.getByRole('radio', { name: /Set aside for me to look at/ }).check();

  await expect(page.getByTestId('summary')).toHaveText(
    '2 pages split into 2 invoices, 1 worth a look.'
  );
  await expect(page.getByTestId('invoice-value-g1')).toContainText('CORRECTED-1');
});

test('undoes and redoes every kind of fix, with the keyboard too', async ({ page }) => {
  await loadFixtures(page, ['03-repeated-number.pdf']);

  await expect(page.getByTestId('undo')).toBeDisabled();

  await page.getByTestId('gap-2').click();
  await page.getByTestId('gap-3').click();
  await expect(page.getByTestId('summary')).toHaveText(
    '3 pages split into 3 invoices, 3 worth a look.'
  );

  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('summary')).toHaveText(
    '3 pages split into 2 invoices, 2 worth a look.'
  );

  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('summary')).toHaveText('3 pages split into 1 invoice.');
  await expect(page.getByTestId('undo')).toBeDisabled();

  await page.keyboard.press('Control+Shift+z');
  await expect(page.getByTestId('summary')).toHaveText(
    '3 pages split into 2 invoices, 2 worth a look.'
  );

  await page.getByTestId('redo').click();
  await expect(page.getByTestId('summary')).toHaveText(
    '3 pages split into 3 invoices, 3 worth a look.'
  );
  await expect(page.getByTestId('redo')).toBeDisabled();
});

test('walks the review queue with the N key', async ({ page }) => {
  await loadFixtures(page, ['05-repeat-later.pdf', '07-bare-invoice.pdf']);

  const queue = page.getByTestId('review-queue');
  await expect(queue).toContainText('3 invoices need a look');
  await expect(queue).toContainText('came from the word "Invoice" on its own');

  await page.keyboard.press('n');
  await expect(page.getByTestId('preview-modal')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Page 1' })).toBeVisible();

  await page.keyboard.press('Escape');
  await page.keyboard.press('n');
  await expect(page.getByRole('heading', { name: 'Page 3' })).toBeVisible();
});

test('asks before exporting while invoices still need a look', async ({ page }) => {
  await loadFixtures(page, ['05-repeat-later.pdf']);

  await page.getByTestId('download-zip').click();

  const dialog = page.getByTestId('confirm-dialog');
  await expect(dialog).toContainText('2 invoices still need a look. Export anyway?');

  // Backing out exports nothing.
  await page.getByRole('button', { name: 'Go back and check' }).click();
  await expect(dialog).toBeHidden();

  // Going ahead does.
  await page.getByTestId('download-zip').click();
  const waitFor = page.waitForEvent('download');
  await page.getByTestId('confirm-export').click();
  const saved = await waitFor;

  expect(saved.suggestedFilename()).toBe('invoices.zip');
});

test('exports straight away once nothing needs a look', async ({ page }) => {
  await loadFixtures(page, ['03-repeated-number.pdf']);

  const waitFor = page.waitForEvent('download');
  await page.getByTestId('download-zip').click();
  const saved = await waitFor;

  expect(saved.suggestedFilename()).toBe('invoices.zip');
  await expect(page.getByTestId('confirm-dialog')).toBeHidden();
});
