/**
 * Learning the shape of each customer's POs, for POs printed with no label:
 * one typed in fills in that customer's other invoices, and only theirs.
 */

import { expect, test } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';

async function invoicePdf(number, customer, po, sum) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const put = (x, y, text) => page.drawText(text, { x, y, size: 11, font });
  put(50, 740, 'Saltmarsh Coffee Roasters');
  put(360, 740, `Invoice No: ${number}`);
  put(50, 680, 'Bill to:');
  put(50, 664, customer);
  // The PO on its own, with no label: only its shape gives it away.
  put(50, 560, po);
  put(360, 300, `Total due: $${sum}`);
  return {
    name: `${number}.pdf`,
    mimeType: 'application/pdf',
    buffer: Buffer.from(await doc.save()),
  };
}

test('learns each customer’s PO shape and fills in only that customer’s invoices', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByTestId('tab-reconcile').click();
  await page
    .getByTestId('pdf-drop-input')
    .setInputFiles([
      await invoicePdf('SM-1', 'Atlas Fitness Ltd', 'AF/2026/0711', '10.00'),
      await invoicePdf('SM-2', 'Atlas Fitness Ltd', 'AF/2026/0712', '20.00'),
      await invoicePdf('SM-3', 'Pinecrest Dental Clinic', 'PDC-55821', '30.00'),
      await invoicePdf('SM-4', 'Pinecrest Dental Clinic', 'PDC-55822', '40.00'),
    ]);
  await page.getByTestId('sheet-drop-input').setInputFiles({
    name: 'register.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'InvNo,Customer,InvAmnt,PONum\nSM-1,Atlas,10.00,AF/2026/0711\nSM-2,Atlas,20.00,AF/2026/0799\nSM-3,Pinecrest,30.00,PDC-55821\nSM-4,Pinecrest,40.00,PDC-55822\n'
    ),
  });
  const results = page.getByTestId('section-results');
  const row = (number) => results.locator('tr', { hasText: number });
  await expect(row('SM-4')).toBeVisible();

  await page.getByTestId('add-po-SM-1').click();
  await page.getByTestId('add-po-SM-1-input').fill('AF/2026/0711');
  await page.getByTestId('add-po-SM-1-input').press('Enter');
  await expect(page.getByText('Atlas Fitness Ltd’s POs look like AF/####/####')).toBeVisible();

  // Atlas's other invoice is filled - and checked against Excel - but Pinecrest's are not.
  await expect(row('SM-2')).toContainText('AF/2026/0712');
  await expect(row('SM-2').locator('.value-tag')).toHaveText('pattern');
  await expect(row('SM-2')).toContainText('PO differs');
  await expect(page.getByTestId('add-po-SM-3')).toBeVisible();

  await page.getByTestId('add-po-SM-3').click();
  await page.getByTestId('add-po-SM-3-input').fill('PDC-55821');
  await page.getByTestId('add-po-SM-3-input').press('Enter');
  await expect(row('SM-4')).toContainText('PDC-55822');
  await expect(page.getByTestId('learned-note')).toContainText(
    'Pinecrest Dental Clinic POs like PDC-#####'
  );
});

test('uses the spreadsheet’s CustName when the PDF names no customer, and a typed PO can be changed', async ({
  page,
}) => {
  /** An invoice with no "Bill to" at all: only Excel says whose it is. */
  async function bare(number, po) {
    const doc = await PDFDocument.create();
    const pdfPage = doc.addPage([612, 792]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    pdfPage.drawText(`Invoice No: ${number}`, { x: 360, y: 740, size: 11, font });
    pdfPage.drawText(po, { x: 50, y: 560, size: 11, font });
    pdfPage.drawText('Total due: $10.00', { x: 360, y: 300, size: 11, font });
    return {
      name: `${number}.pdf`,
      mimeType: 'application/pdf',
      buffer: Buffer.from(await doc.save()),
    };
  }

  await page.goto('/');
  await page.getByTestId('tab-reconcile').click();
  await page
    .getByTestId('pdf-drop-input')
    .setInputFiles([
      await bare('KX-1', 'GF-20113'),
      await bare('KX-2', 'GF-20114'),
      await bare('KX-3', '7781-AB'),
    ]);
  await page.getByTestId('sheet-drop-input').setInputFiles({
    name: 'register.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'InvNo,CustName,InvAmnt,PONum\nKX-1,Greenfield Farms,10.00,GF-20113\nKX-2,Greenfield Farms,10.00,GF-20114\nKX-3,Harbor Bakery,10.00,7781-AB\n'
    ),
  });
  const results = page.getByTestId('section-results');
  const row = (number) => results.locator('tr', { hasText: number });
  await expect(row('KX-3')).toBeVisible();

  // Typed with a slip first: a shape is learned from it, for Greenfield Farms (from Excel).
  await page.getByTestId('add-po-KX-1').click();
  await page.getByTestId('add-po-KX-1-input').fill('GF-2011');
  await page.getByTestId('add-po-KX-1-input').press('Enter');
  await expect(page.getByTestId('learned-note')).toContainText('Greenfield Farms POs like GF-####');

  // Changed: the slip's shape goes, the right one is learned, and KX-2 fills in.
  await row('KX-1').hover();
  await page.getByTestId('edit-po-KX-1').click();
  await page.getByTestId('edit-po-KX-1-input').fill('GF-20113');
  await page.getByTestId('edit-po-KX-1-input').press('Enter');
  await expect(row('KX-1')).toContainText('GF-20113');
  await expect(page.getByTestId('learned-note')).toContainText(
    'Greenfield Farms POs like GF-#####'
  );
  await expect(page.getByTestId('learned-note')).not.toContainText('GF-####,');
  await expect(row('KX-2')).toContainText('GF-20114');
  await expect(row('KX-2').locator('.value-tag')).toHaveText('pattern');
  // Another customer's invoice is left alone.
  await expect(page.getByTestId('add-po-KX-3')).toBeVisible();
});
