import { describe, expect, it } from 'vitest';
import { poKey, readFields } from '../../src/core/fields.js';
import { compareWithSheet } from '../../src/core/reconcile/compare.js';
import {
  guessFieldColumns,
  guessSheetLayout,
  sheetEntries,
} from '../../src/core/reconcile/sheet.js';

const page = (...lines) => ({ text: lines.join('\n') });
const usd = (amount, raw) => ({ amount, currency: 'USD', raw });

describe('reading the PO off an invoice', () => {
  it('finds it beside or under its label, in any of the usual wordings', () => {
    expect(readFields([page('PO Number:', 'PO-4500118')]).po.value).toBe('PO-4500118');
    expect(readFields([page('P.O. No: 55103388')]).po.value).toBe('55103388');
    expect(readFields([page('Purchase Order', 'PC-7790')]).po.value).toBe('PC-7790');
    expect(readFields([page('Customer PO # 7781-A')]).po.value).toBe('7781-A');
  });

  it('is not fooled by a PO Box, a date or an amount', () => {
    expect(readFields([page('PO Box 12', 'Leeds LS1 4AB')]).po).toBeNull();
    expect(readFields([page('PO Number: 2026-10-01')]).po).toBeNull();
    expect(readFields([page('Order No: 1,297.48')]).po).toBeNull();
  });

  it('compares POs however they were typed', () => {
    expect(poKey('PO 55103388')).toBe(poKey('55103388'));
    expect(poKey('po-4500118')).toBe(poKey('PO4500118'));
    expect(poKey('PC-7790')).not.toBe(poKey('PC-7709'));
  });
});

describe('finding the amount and PO columns in a sheet', () => {
  it('knows a PO column from an amount column', () => {
    const headers = ['Invoice No', 'Customer', 'PO Number', 'PO Amount'];
    expect(guessFieldColumns(headers, 0)).toMatchObject({ po: 2, amount: 3 });
    expect(guessFieldColumns(['Inv', 'Purchase order', 'Total'], 0)).toMatchObject({
      po: 1,
      amount: 2,
    });
  });
});

describe('an invoice against its row in Excel', () => {
  it('agrees when the amount and PO are the same', () => {
    const check = compareWithSheet(
      { total: usd(1297.48, '$1,297.48'), po: { value: 'PO-4500118' } },
      { amount: '1297.48', po: '4500118' }
    );
    expect(check.priceDiffers).toBe(false);
    expect(check.poDiffers).toBe(false);
    expect(check.notes).toEqual([]);
  });

  it('flags a different price, says by how much and which way', () => {
    const check = compareWithSheet({ total: usd(363.96, '$363.96') }, { amount: '336.96' });
    expect(check.priceDiffers).toBe(true);
    expect(check.amount.difference).toBe(-27);
    expect(check.notes).toEqual([
      'Price differs: PDF $363.96, Excel 336.96 (Excel is $27.00 less)',
    ]);
  });

  it('allows for a sheet rounding to the cent', () => {
    expect(compareWithSheet({ total: usd(10.004, '$10.00') }, { amount: '10' }).priceDiffers).toBe(
      false
    );
  });

  it('flags a different currency even when the number is the same', () => {
    const check = compareWithSheet({ total: usd(100, '$100.00') }, { amount: '€100.00' });
    expect(check.priceDiffers).toBe(true);
    expect(check.notes[0]).toMatch(/Currency differs/);
  });

  it('flags a different PO', () => {
    const check = compareWithSheet({ po: { value: 'PC-7790' } }, { po: 'PC-7709' });
    expect(check.poDiffers).toBe(true);
    expect(check.notes).toEqual(['PO differs: PDF PC-7790, Excel PC-7709']);
  });

  it('does not call an empty cell a disagreement, but says what it could not check', () => {
    expect(compareWithSheet({ total: usd(5, '$5.00') }, {}).priceDiffers).toBe(false);
    const check = compareWithSheet({}, { amount: '5.00', po: 'PO-1' });
    expect(check.priceDiffers || check.poDiffers).toBe(false);
    expect(check.notes).toEqual([
      'No total found on the PDF to check the amount against',
      'No PO found on the PDF to check against',
    ]);
  });
});

describe('spreadsheets with short or joined-up headings', () => {
  it('reads InvAmnt, InvAmt and Inv_Amount as the amount, and PONum as the PO', () => {
    for (const heading of ['InvAmnt', 'InvAmt', 'Inv_Amount', 'AMT', 'Invoice Total']) {
      expect(guessFieldColumns(['InvNo', heading], 0)).toMatchObject({ amount: 1 });
    }
    expect(guessFieldColumns(['InvNo', 'PONum', 'InvAmnt'], 0)).toMatchObject({ po: 1, amount: 2 });
    expect(guessFieldColumns(['InvNo', 'Net Terms', 'InvAmnt'], 0)).toMatchObject({ amount: 2 });
  });

  it('never takes the amount or date column for the invoice numbers', () => {
    const rows = [
      ['InvDate', 'InvAmnt', 'InvNo', 'PONum'],
      ['2026-09-02', '1297.48', 'HL-24017', '4500118'],
    ];
    const layout = guessSheetLayout(rows);
    expect(layout.invoiceColumn).toBe(2);
    const { entries } = sheetEntries(rows, layout, layout.headers);
    expect(entries[0]).toMatchObject({
      invoice: 'HL-24017',
      fields: { amount: '1297.48', po: '4500118' },
    });
  });
});

describe('reading the invoice amount off a PDF', () => {
  it('knows the usual ways of printing it', () => {
    for (const label of [
      'Invoice Amount:',
      'Invoice Value',
      'Inv Amt',
      'Total Invoice Amount',
      'Net Payable',
    ]) {
      expect(readFields([page(`${label} $1,297.48`)]).total.amount).toBe(1297.48);
    }
  });
});
