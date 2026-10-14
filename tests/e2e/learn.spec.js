/**
 * Teaching Reconcile where a supplier prints its PO and its amount: type one
 * in, and the rest of the batch - and the next one - is read the same way.
 */

import { expect, test } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';

/** An invoice whose PO and amount sit under labels the app does not know. */
async function invoicePdf(number, buyerRef, sum) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const put = (x, y, text) => page.drawText(text, { x, y, size: 11, font });
  put(50, 740, 'Saltmarsh Coffee Roasters');
  put(360, 740, `Invoice No: ${number}`);
  put(360, 722, 'Date: Oct 1, 2026');
  put(360, 704, `Buyer Ref: ${buyerRef}`);
  put(50, 600, 'Espresso beans 1kg');
  put(360, 300, `Sum payable: $${sum}`);
  return {
    name: `${number}.pdf`,
    mimeType: 'application/pdf',
    buffer: Buffer.from(await doc.save()),
  };
}

const sheet = {
  name: 'register.csv',
  mimeType: 'text/csv',
  buffer: Buffer.from(
    'InvNo,InvAmnt,PONum\nSM-9001,120.00,BR-1001\nSM-9002,75.50,BR-1002\nSM-9003,40.00,BR-9999\n'
  ),
};

async function load(page) {
  await page
    .getByTestId('pdf-drop-input')
    .setInputFiles([
      await invoicePdf('SM-9001', 'BR-1001', '120.00'),
      await invoicePdf('SM-9002', 'BR-1002', '75.50'),
      await invoicePdf('SM-9003', 'BR-1003', '44.00'),
    ]);
  await page.getByTestId('sheet-drop-input').setInputFiles(sheet);
  await expect(page.getByTestId('section-results')).toBeVisible();
}

test('learns where the PO and the amount are from one invoice and fills in the rest', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByTestId('tab-reconcile').click();
  await load(page);
  const results = page.getByTestId('section-results');
  const row = (number) => results.locator('tr', { hasText: number });

  // Nothing it knows labels them, so there is a way to type them in.
  await page.getByTestId('add-po-SM-9001').click();
  await page.getByTestId('add-po-SM-9001-input').fill('BR-1001');
  await page.getByTestId('add-po-SM-9001-input').press('Enter');
  await expect(page.getByText('Learned: the PO follows “Buyer Ref”')).toBeVisible();
  await expect(row('SM-9002')).toContainText('BR-1002');
  await expect(row('SM-9002').locator('.value-tag')).toHaveText('learned');
  await expect(row('SM-9001').locator('.value-tag')).toHaveText('typed');
  // And what it read is checked against Excel like anything else.
  await expect(row('SM-9003')).toContainText('PO differs');

  await page.getByTestId('add-total-SM-9002').click();
  await page.getByTestId('add-total-SM-9002-input').fill('75.50');
  await page.getByTestId('add-total-SM-9002-input').press('Enter');
  await expect(page.getByText('Learned: the amount follows “Sum payable”')).toBeVisible();
  await expect(row('SM-9003')).toContainText('Price differs');
  await expect(row('SM-9003')).toContainText('$44.00');
  await expect(row('SM-9001')).toContainText('Matched');

  // Remembered for the next batch.
  await page.reload();
  await page.getByTestId('tab-reconcile').click();
  await load(page);
  await expect(page.getByTestId('learned-note')).toContainText('PO after “Buyer Ref”');
  await expect(row('SM-9001')).toContainText('BR-1001');
  await expect(row('SM-9003')).toContainText('Price differs');

  await page.getByTestId('learned-note').getByRole('button', { name: 'Forget' }).click();
  await expect(page.getByTestId('add-po-SM-9001')).toBeVisible();
});

test('values can be corrected beside the invoice, while looking at it', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('tab-reconcile').click();
  await load(page);
  const results = page.getByTestId('section-results');
  const row = (number) => results.locator('tr', { hasText: number });

  // Clicking a row opens the invoice, with its values beside it.
  await row('SM-9003').locator('td').first().click();
  const details = page.getByTestId('invoice-details');
  await expect(details.getByTestId('detail-invoice')).toHaveValue('SM-9003');
  await expect(details).toContainText('Excel: BR-9999');

  await details.getByTestId('detail-total').fill('44.00');
  await details.getByTestId('detail-total').press('Enter');
  // The amount it learned from disagrees with Excel's 40.00: said beside it, in red.
  await expect(page.getByTestId('details-status')).toHaveText('Price differs');
  await expect(details.locator('.detail-field.is-different')).toContainText('Amount');
  await expect(details).toContainText('Difference −$4.00');

  await details.getByTestId('detail-po').fill('BR-9999');
  await details.getByTestId('detail-po').press('Enter');
  await expect(details.getByTestId('detail-po')).toHaveValue('BR-9999');
  // The pages stay open while values change.
  await expect(page.getByTestId('pdf-preview').locator('canvas')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(row('SM-9003')).toContainText('BR-9999');
  // Learned from what was typed beside the invoice, as from the table.
  await expect(row('SM-9001')).toContainText('$120.00');
});

test('an invoice with no number can be given one beside it, and is then matched', async ({
  page,
}) => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([612, 792]).drawText('Total due: $75.50', { x: 360, y: 300, size: 11, font });
  await page.goto('/');
  await page.getByTestId('tab-reconcile').click();
  await page.getByTestId('pdf-drop-input').setInputFiles({
    name: 'unnumbered.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await doc.save()),
  });
  await page.getByTestId('sheet-drop-input').setInputFiles(sheet);
  const results = page.getByTestId('section-results');
  await results.locator('tr', { hasText: 'No number found' }).locator('td').first().click();
  await page.getByTestId('detail-invoice').fill('SM-9002');
  await page.getByTestId('detail-invoice').press('Enter');
  await expect(page.getByTestId('details-status')).toHaveText('Matched');
  await page.keyboard.press('Escape');
  await expect(results.locator('tr', { hasText: 'SM-9002' }).first()).toContainText('Typed by you');
});
