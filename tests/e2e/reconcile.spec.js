/**
 * The Reconcile tab: a bulk PDF is split into invoices, and every invoice is
 * checked against a sheet in one table.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => join(HERE, '..', 'fixtures', 'pdf', name);

test('splits a bulk PDF and checks each invoice against a CSV in one table', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('tab-reconcile').click();

  // Three pages: INV-2001, INV-2002, then INV-2001 again.
  await page.getByTestId('pdf-drop-input').setInputFiles(fixture('05-repeat-later.pdf'));
  await expect(page.getByTestId('pdf-summary')).toContainText('1 file, 3 invoices');

  await page.getByTestId('sheet-drop-input').setInputFiles({
    name: 'invoices.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('Invoice\nINV-2001\nINV-9999\n'),
  });

  const results = page.getByTestId('section-results');
  await expect(page.getByTestId('count-results')).toHaveText('4');
  await expect(results.locator('tbody tr').first()).toContainText('Missing PDF');
  await expect(results.locator('tbody tr').first()).toContainText('INV-9999');
  await expect(results.locator('tr', { hasText: 'INV-2002' })).toContainText('Not in sheet');
  await expect(results.locator('tr', { hasText: 'Matched' })).toHaveCount(2);
  await expect(results).toContainText('05-repeat-later.pdf (p. 3)');

  // One click shows only one status.
  await page.getByTestId('show-onlySheet').click();
  await expect(page.getByTestId('count-results')).toHaveText('1');
  await expect(results.locator('tbody tr')).toContainText('INV-9999');
  await page.getByTestId('show-all').click();
  await expect(page.getByTestId('count-results')).toHaveText('4');
});
