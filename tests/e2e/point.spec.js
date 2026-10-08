/**
 * Showing the app where the invoice number is, by drawing a box around it.
 *
 * The app asks for this on the first page of a batch that no saved spot covers.
 * One box, drawn like a screenshot, and every page from that client is read from
 * inside it - including the pages that carry no number there at all, which stay
 * with the invoice they continue.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => join(HERE, '..', 'fixtures', 'pdf', name);

async function loadFixtures(page, names) {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(names.map(fixture));
  await expect(page.getByTestId('page-strip')).toBeVisible();
}

/**
 * Drag a box around some words on the page, the way a person drags with a
 * screenshot tool: from a little above and left of them to a little below and
 * right, with the mouse, not a selection.
 */
async function drawBoxAround(page, text) {
  const words = page.locator('.textLayer span', { hasText: text }).first();
  await words.waitFor();
  const at = await words.boundingBox();
  await page.mouse.move(at.x - 5, at.y - 4);
  await page.mouse.down();
  await page.mouse.move(at.x + at.width + 5, at.y + at.height + 4, { steps: 6 });
  await page.mouse.up();
}

/**
 * Drag a box over a patch of the page with nothing in it: the band between the
 * heading and the table, near enough the top to be on screen.
 */
async function drawEmptyBox(page) {
  const sheet = await page.getByTestId('spot-picker').boundingBox();
  await page.mouse.move(sheet.x + sheet.width * 0.1, sheet.y + sheet.height * 0.15);
  await page.mouse.down();
  await page.mouse.move(sheet.x + sheet.width * 0.4, sheet.y + sheet.height * 0.21, { steps: 4 });
  await page.mouse.up();
}

test('asks to be shown the number, and reads the whole batch from one box', async ({ page }) => {
  await loadFixtures(page, ['22-boxed-number.pdf']);

  // Nothing recognises this client's heading, so nothing is found.
  await expect(page.getByTestId('summary')).toHaveText(
    '4 pages split into 1 invoice, 1 worth a look.'
  );
  await expect(page.getByTestId('point-prompt')).toContainText(
    'Show the app where the invoice number is'
  );

  await page.getByTestId('point-prompt-go').click();
  await expect(page.getByTestId('point-banner')).toContainText(
    'Drag a box around the invoice number'
  );

  await drawBoxAround(page, '50621');
  await expect(page.getByTestId('spot-box')).toBeVisible();
  // What the box reads is shown before anything is saved.
  await expect(page.getByTestId('spot-value')).toHaveText('50621');
  await page.getByTestId('spot-save').click();

  await expect(page.getByTestId('teach-result')).toContainText('Found 50621 in that spot');
  await expect(page.getByTestId('teach-result')).toContainText('2 invoices in this batch');
  await page.getByRole('button', { name: 'Done' }).click();

  // Pages 2 and 4 carry a subtotal where the number goes. It is not shaped like
  // the number that was boxed, so each stays with the invoice it continues.
  await expect(page.getByTestId('summary')).toHaveText('4 pages split into 2 invoices.');
  const table = page.getByTestId('invoice-table');
  await expect(table).toContainText('50621.pdf');
  await expect(table).toContainText('50698.pdf');
  await expect(table).toContainText('1 to 2');
  await expect(table).toContainText('3 to 4');
  await expect(table).toContainText('the spot you chose');
  await expect(table).not.toContainText('472');

  await expect(page.getByTestId('point-prompt')).toHaveCount(0);
});

test('does not ask again about a client it has already been shown', async ({ page }) => {
  await loadFixtures(page, ['22-boxed-number.pdf']);
  await page.getByTestId('point-prompt-go').click();
  await drawBoxAround(page, '50621');
  await page.getByTestId('spot-save').click();
  await page.getByRole('button', { name: 'Done' }).click();

  // The next batch from the same client.
  await page.getByRole('button', { name: 'Start again' }).click();
  await page.getByTestId('file-input').setInputFiles([fixture('22-boxed-number.pdf')]);
  await expect(page.getByTestId('summary')).toHaveText('4 pages split into 2 invoices.');
  await expect(page.getByTestId('point-prompt')).toHaveCount(0);
});

test('moves on to the next client in a mixed batch', async ({ page }) => {
  await loadFixtures(page, ['22-boxed-number.pdf', '21-column-heading.pdf']);
  await expect(page.getByTestId('point-prompt-go')).toHaveText('Point to it on page 1');

  await page.getByTestId('point-prompt-go').click();
  await drawBoxAround(page, '50621');
  await page.getByTestId('spot-save').click();
  await page.getByRole('button', { name: 'Done' }).click();

  // Pages 5 and 6 are another client's, and nothing has been shown for them.
  await expect(page.getByTestId('point-prompt')).toContainText(
    'Some pages are not read from a saved spot yet'
  );
  await expect(page.getByTestId('point-prompt-go')).toHaveText('Point to it on page 5');
});

test('says so when the box has no invoice number in it', async ({ page }) => {
  await loadFixtures(page, ['22-boxed-number.pdf']);
  await page.getByTestId('point-prompt-go').click();

  await drawEmptyBox(page);
  await expect(page.getByTestId('spot-empty')).toContainText('no invoice number inside that box');
  await expect(page.getByTestId('spot-save')).toHaveCount(0);

  // And a second go works.
  await page.getByRole('button', { name: 'Draw again' }).click();
  await drawBoxAround(page, '50621');
  await expect(page.getByTestId('spot-value')).toHaveText('50621');
});

test('can be pointed from any page, not only when asked', async ({ page }) => {
  await loadFixtures(page, ['21-column-heading.pdf']);
  await page.getByTestId('point-prompt-dismiss').click();
  await expect(page.getByTestId('point-prompt')).toHaveCount(0);

  await page.getByTestId('tile-1').click();
  await page.getByTestId('point-start').click();
  await drawBoxAround(page, 'SR-40881_2');
  await expect(page.getByTestId('spot-value')).toHaveText('SR-40881_2');
  await page.getByTestId('spot-save').click();
  await expect(page.getByTestId('teach-result')).toContainText('Found SR-40881_2 in that spot');
  await page.getByRole('button', { name: 'Done' }).click();

  const table = page.getByTestId('invoice-table');
  await expect(table).toContainText('the spot you chose');
  await expect(table).toContainText('SR-40997_1.pdf');
  await page.getByTestId('advanced-toggle').click();
  await expect(page.getByTestId('remembered-boxes')).toContainText(
    'One client is remembered in this browser'
  );
});

test('remembers a box after the page is closed and opened again', async ({ page }) => {
  await loadFixtures(page, ['22-boxed-number.pdf']);
  await page.getByTestId('point-prompt-go').click();
  await drawBoxAround(page, '50621');
  await page.getByTestId('spot-save').click();
  await page.getByRole('button', { name: 'Done' }).click();

  await page.reload();
  await page.getByTestId('file-input').setInputFiles([fixture('22-boxed-number.pdf')]);

  await expect(page.getByTestId('summary')).toHaveText('4 pages split into 2 invoices.');
  await expect(page.getByTestId('point-prompt')).toHaveCount(0);
});

test('forgets one client box from their page', async ({ page }) => {
  await loadFixtures(page, ['21-column-heading.pdf']);
  await page.getByTestId('point-prompt-go').click();
  await drawBoxAround(page, 'SR-40881_2');
  await page.getByTestId('spot-save').click();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByTestId('invoice-table')).toContainText('the spot you chose');

  await page.getByTestId('tile-1').click();
  await expect(page.getByTestId('point-start')).toHaveText('Draw the box again');
  await page.getByTestId('forget-box').click();
  await expect(page.getByTestId('point-start')).toHaveText('Point to the invoice number');
  await page.keyboard.press('Escape');

  // Without the box the everyday label answers instead, and still gets it right.
  await expect(page.getByTestId('invoice-table')).toContainText('an everyday label');
  await page.getByTestId('advanced-toggle').click();
  await expect(page.getByTestId('remembered-boxes')).toContainText('None yet');
});

test('forgets every box at once, after asking', async ({ page }) => {
  await loadFixtures(page, ['22-boxed-number.pdf']);
  await page.getByTestId('point-prompt-go').click();
  await drawBoxAround(page, '50621');
  await page.getByTestId('spot-save').click();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByTestId('summary')).toHaveText('4 pages split into 2 invoices.');

  await page.getByTestId('advanced-toggle').click();
  await page.getByTestId('forget-boxes').click();
  await page.getByRole('button', { name: 'Yes, forget them' }).click();

  await expect(page.getByTestId('summary')).toHaveText(
    '4 pages split into 1 invoice, 1 worth a look.'
  );
  await expect(page.getByTestId('point-prompt')).toBeVisible();
});

test("draws a box on a scan that carries the scanner's own text, without reading it first", async ({
  page,
}) => {
  await loadFixtures(page, ['24-scanned-with-own-text.pdf']);

  // Every page is a picture, so reading it is offered - but not needed.
  await expect(page.getByTestId('scanned-notice')).toContainText('5 pages look like scans');

  await page.getByTestId('point-prompt-go').click();
  const number = page.locator('.textLayer span', { hasText: /^7730051-1107$/ });
  await number.waitFor();
  const at = await number.boundingBox();
  await page.mouse.move(at.x - 5, at.y - 4);
  await page.mouse.down();
  await page.mouse.move(at.x + at.width + 5, at.y + at.height + 4, { steps: 6 });
  await page.mouse.up();

  await expect(page.getByTestId('spot-value')).toHaveText('7730051-1107');
  // Not the first line, which is the time the page was printed.
  await expect(page.getByTestId('spot-client')).toHaveText('Paid Fulfilled Notes');
  await page.getByTestId('spot-save').click();
  await page.getByRole('button', { name: 'Done' }).click();

  // Every order, the longer numbers too, and each second page with its order.
  await expect(page.getByTestId('summary')).toHaveText('5 pages split into 3 invoices.');
  const table = page.getByTestId('invoice-table');
  await expect(table).toContainText('7730051-1107.pdf');
  await expect(table).toContainText('9902114705-0031.pdf');
  await expect(table).toContainText('7730051-1103.pdf');
  // The box read them from the scanner's text, so there is nothing left to offer.
  await expect(page.getByTestId('scanned-notice')).toHaveCount(0);
});

test('lets the offer to read scanned pages be waved off', async ({ page }) => {
  await loadFixtures(page, ['24-scanned-with-own-text.pdf']);
  await expect(page.getByTestId('scanned-notice')).toBeVisible();

  await page.getByTestId('scanned-dismiss').click();
  await expect(page.getByTestId('scanned-notice')).toHaveCount(0);
});

test('reads invoices to every customer from one box, and does not ask about the terms pages', async ({
  page,
}) => {
  await loadFixtures(page, ['25-invoices-with-terms.pdf']);
  await expect(page.getByTestId('summary')).toHaveText(
    '8 pages split into 1 invoice, 1 worth a look.'
  );

  await page.getByTestId('point-prompt-go').click();
  await drawBoxAround(page, 'SI-7710001');
  await expect(page.getByTestId('spot-value')).toHaveText('SI-7710001');
  // Named after the supplier's letterhead, not the customer the invoice is to.
  await expect(page.getByTestId('spot-client')).toHaveText(
    'MARLOWE ATELIER VAT #: IT00999888777 Invoice'
  );
  await page.getByTestId('spot-save').click();
  await page.getByRole('button', { name: 'Done' }).click();

  // Every customer's invoice, the one with another VAT number too, each with
  // the terms page after it.
  await expect(page.getByTestId('summary')).toHaveText('8 pages split into 4 invoices.');
  const table = page.getByTestId('invoice-table');
  for (const number of ['SI-7710001', 'SI-7710002', 'SI-7710015', 'SI-7710021']) {
    await expect(table).toContainText(`${number}.pdf`);
  }
  await expect(table).toContainText('7 to 8');
  // The terms pages are the same every time, so there is nothing to point at.
  await expect(page.getByTestId('point-prompt')).toHaveCount(0);
});
