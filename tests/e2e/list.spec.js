/**
 * Checking the batch against the person's own list of invoice numbers.
 * Every number and name here is invented.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { workbook } from '../helpers/workbook.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => join(HERE, '..', 'fixtures', 'pdf', name);

async function loadFixtures(page, names) {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(names.map(fixture));
  await expect(page.getByTestId('page-strip')).toBeVisible();
}

const csv = (text) => ({
  name: 'open-invoices.csv',
  mimeType: 'text/csv',
  buffer: Buffer.from(text),
});

test('verifies what is in the list, offers the near miss, and names what is missing', async ({
  page,
}) => {
  // 104233 and 100777 are in these two files.
  await loadFixtures(page, ['01-same-line.pdf', '03-repeated-number.pdf']);
  await page
    .getByTestId('list-input')
    .setInputFiles(
      csv('Invoice No,Customer\n104233,Lakeshore\n100771,Contoso\n555000,Northwind\n')
    );

  // The columns are worked out from the headings, and can be changed.
  await expect(page.getByTestId('list-invoice-column')).toHaveValue('0');
  await expect(page.getByTestId('list-client-column')).toHaveValue('1');
  await page.getByTestId('list-apply').click();

  await expect(page.getByTestId('list-summary')).toContainText(
    '3 invoice numbers loaded from open-invoices.csv. 1 of this batch’s 2 invoices are in it.'
  );
  await expect(page.getByTestId('verified-g1')).toHaveText('In your invoice list');

  // 100777 is one character from 100771: offered, never put in by itself.
  const queue = page.getByTestId('review-queue');
  await expect(queue).toContainText(
    '100777 on pages 3 to 5 is not in your invoice list, but 100771 is - one character differs.'
  );
  await expect(page.getByTestId('invoice-table')).toContainText('100777.pdf');

  // The one in the list that the batch does not have.
  await page.getByTestId('list-missing').locator('summary').click();
  await expect(page.getByTestId('list-missing')).toContainText('555000');
  await expect(page.getByTestId('list-missing')).toContainText('Northwind');
  await expect(page.getByTestId('list-missing')).not.toContainText('100771');

  // One click puts the suggestion in, and then it is in the list.
  await page.getByRole('button', { name: 'Use 100771' }).first().click();
  await expect(page.getByTestId('invoice-table')).toContainText('100771.pdf');
  await expect(page.getByTestId('verified-g3')).toBeVisible();
  await expect(page.getByTestId('review-queue')).toHaveCount(0);
  await expect(page.getByTestId('list-missing')).not.toContainText('100771');
});

test('in strict mode only invoices in the list go out without a look', async ({ page }) => {
  await loadFixtures(page, ['01-same-line.pdf', '03-repeated-number.pdf']);
  await page.getByTestId('list-input').setInputFiles(csv('Invoice\n104233\n'));
  await page.getByTestId('list-apply').click();

  await expect(page.getByTestId('review-queue')).toContainText(
    '100777 on pages 3 to 5 is not in your invoice list.'
  );
  await expect(page.getByTestId('list-strict')).toBeChecked();

  // Off, a number not in the list is only noted.
  await page.getByTestId('list-strict').uncheck();
  await expect(page.getByTestId('review-queue')).toHaveCount(0);
  await expect(page.getByTestId('invoice-table')).toContainText('Not in your invoice list');

  await page.getByTestId('list-remove').click();
  await expect(page.getByTestId('invoice-table')).not.toContainText('Not in your invoice list');
});

test('reads an Excel list, and remembers which columns were chosen', async ({ page }) => {
  await loadFixtures(page, ['01-same-line.pdf']);
  const excel = {
    name: 'march.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: await workbook([
      ['Account', 'Reference', 'Amount'],
      ['Lakeshore', '104233', '642.00'],
      ['Contoso', '104301', '318.00'],
    ]),
  };
  await page.getByTestId('list-input').setInputFiles(excel);

  // "Reference" is not a heading it knows, so the numbers are found by looking.
  await expect(page.getByTestId('list-invoice-column')).toHaveValue('1');
  await page.getByTestId('list-client-column').selectOption('0');
  await page.getByTestId('list-apply').click();
  await expect(page.getByTestId('list-summary')).toContainText(
    '2 invoice numbers loaded from march.xlsx'
  );

  // Next time a list with the same headings is used straight away.
  await page.reload();
  await page.getByTestId('file-input').setInputFiles([fixture('01-same-line.pdf')]);
  await page.getByTestId('list-input').setInputFiles(excel);
  await expect(page.getByTestId('list-summary')).toContainText('2 invoice numbers loaded');
  await expect(page.getByTestId('list-columns')).toHaveCount(0);
});

test('says plainly when a list file cannot be used', async ({ page }) => {
  await loadFixtures(page, ['01-same-line.pdf']);
  await page.getByTestId('list-input').setInputFiles({
    name: 'old.xls',
    mimeType: 'application/vnd.ms-excel',
    buffer: Buffer.from('not really'),
  });
  await expect(page.getByTestId('list-error')).toContainText(
    'This is an older Excel file (.xls). Open it in Excel and save it as .xlsx or .csv'
  );
});
