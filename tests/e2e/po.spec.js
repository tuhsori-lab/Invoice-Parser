/**
 * Every invoice's purchase order, listed under the table and ready to copy.
 *
 * Collections work runs on POs as much as on invoice numbers, so this is the
 * list somebody pastes into a chase email or a reconciliation sheet.
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

test('lists each invoice with its PO, and says which have none', async ({ page }) => {
  await loadFixtures(page, ['20-form-layout.pdf', '21-column-heading.pdf']);

  const list = page.getByTestId('po-list');
  await expect(list).toBeVisible();
  await expect(page.getByTestId('po-count')).toHaveText('Found on 1 of 3 invoices.');

  // Taken from under the P.O. NUMBER heading, not the seller's ORDER # beside it.
  await expect(list).toContainText('2071548');
  await expect(list).toContainText('7730415');
  await expect(list).toContainText('P.O. NUMBER');
  await expect(list).not.toContainText('5512086');

  await expect(list).toContainText('SR-40881_2');
  await expect(list.getByText('none found')).toHaveCount(2);
});

test('copies the list as two columns that paste into a spreadsheet', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await loadFixtures(page, ['20-form-layout.pdf', '21-column-heading.pdf']);

  await page.getByTestId('po-copy').click();
  await expect(page.getByTestId('po-copied')).toHaveText('Copied 3 rows. Paste it anywhere.');

  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toBe('Invoice\tPO\n2071548\t7730415\nSR-40881_2\t\nSR-40997_1\t\n');
});

test('follows the search, and copies only what it shows', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await loadFixtures(page, ['20-form-layout.pdf', '21-column-heading.pdf']);

  await page.getByPlaceholder(/Search/).fill('2071548');
  await expect(page.getByTestId('po-count')).toHaveText('Found on the one invoice.');

  await page.getByTestId('po-copy').click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toBe('Invoice\tPO\n2071548\t7730415\n');
});

test('can be switched off', async ({ page }) => {
  await loadFixtures(page, ['20-form-layout.pdf']);
  await expect(page.getByTestId('po-list')).toBeVisible();

  await page.getByTestId('advanced-toggle').click();
  await page.getByTestId('list-pos').uncheck();
  await expect(page.getByTestId('po-list')).toHaveCount(0);

  // The table is untouched: the list is only a view of what was already found.
  await expect(page.getByTestId('invoice-table')).toContainText('2071548');
});
