/**
 * The Summary tab: what each invoice sent is worth and when it is due, from the
 * PDFs and the sheet loaded on Reconcile.
 *
 * The invoices are drawn here, dated relative to today, so one is always overdue
 * and one never is, whatever day the test runs.
 */

import { expect, test } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';

const iso = (daysAgo) => {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return date.toLocaleDateString('en-CA');
};

/** A bulk PDF of invoices, one page each, laid out the usual way. */
async function invoicesPdf(invoices) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const invoice of invoices) {
    const page = pdf.addPage([612, 792]);
    const text = (t, x, y) => page.drawText(t, { x, y, size: 10, font });
    text('Acme Invoicing Ltd', 56, 740);
    text('Bill To:', 56, 690);
    text(invoice.customer, 56, 676);
    text('Invoice No.', 360, 690);
    text(invoice.number, 455, 690);
    text('Invoice Date:', 360, 675);
    text(invoice.date, 455, 675);
    text('Terms:', 360, 660);
    text('Net 30', 455, 660);
    text('Total Due', 380, 260);
    text(invoice.total, 480, 260);
  }
  return Buffer.from(await pdf.save());
}

test('sums up what is owed and when, from the PDFs and the sheet', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('tab-reconcile').click();

  await page.getByTestId('pdf-drop-input').setInputFiles({
    name: 'invoices.pdf',
    mimeType: 'application/pdf',
    buffer: await invoicesPdf([
      { number: 'A-100', customer: 'Lakeshore Cafe', date: iso(40), total: '$1,200.00' },
      { number: 'A-101', customer: 'Atlas Fitness', date: iso(0), total: '$300.00' },
    ]),
  });
  await expect(page.getByTestId('pdf-summary')).toContainText('2 invoices');
  await page.getByTestId('sheet-drop-input').setInputFiles({
    name: 'register.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      `Invoice No,Amount,Status\nA-100,1200.00,Open\nA-101,300.00,Open\nA-099,50.00,Paid\n`
    ),
  });
  await page.getByTestId('section-results').waitFor();

  await page.getByTestId('tab-summary').click();
  const filter = page.getByTestId('summary-filter');
  await expect(filter).toContainText('Past due1');
  await expect(filter).toContainText('Not due yet1');
  await expect(filter).toContainText('Paid1');

  const totals = page.getByTestId('summary-totals');
  await expect(totals).toContainText('$1,500.00');
  await expect(totals).toContainText('$1,200.00');

  const summary = page.getByTestId('section-summary');
  await expect(summary.locator('tbody tr').first()).toContainText('Past due 10 days');
  await expect(summary.locator('tbody tr').first()).toContainText('Lakeshore Cafe');
  await expect(page.getByTestId('section-customers').locator('tbody tr').first()).toContainText(
    'Lakeshore Cafe'
  );
});
