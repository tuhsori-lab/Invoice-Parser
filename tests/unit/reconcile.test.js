/**
 * Cross-checking invoice PDFs against a spreadsheet. Every number is invented.
 */

import { describe, expect, it } from 'vitest';
import { cleanPrefixes, matchKey } from '../../src/core/reconcile/normalize.js';
import { numberFromFileName } from '../../src/core/reconcile/fileName.js';
import { reconcile } from '../../src/core/reconcile/match.js';
import {
  guessFieldColumns,
  guessSheetLayout,
  sheetEntries,
} from '../../src/core/reconcile/sheet.js';

describe('cleaning a number up for matching', () => {
  it('takes off prefixes, separators and leading zeros, and ignores capitals', () => {
    for (const written of ['INV-00123', 'inv 123', '#123', ' 0123 ', 'Invoice 123', 'INV00123']) {
      expect(matchKey(written)).toBe('123');
    }
    expect(matchKey('2026/FX/00940')).toBe('2026FX00940');
  });

  it('does not eat a number that only starts with a prefix', () => {
    expect(matchKey('NOVA-7')).toBe('NOVA7');
    expect(matchKey('INVERNESS')).toBe('INVERNESS');
  });

  it('keeps a lone zero, and gives nothing for nothing', () => {
    expect(matchKey('000')).toBe('0');
    expect(matchKey('  ')).toBe('');
  });

  it('uses the prefixes chosen in Settings', () => {
    const prefixes = cleanPrefixes('SO-, Order #');
    expect(prefixes).toEqual(['ORDER', 'SO']);
    expect(matchKey('SO-80155', { prefixes })).toBe('80155');
    expect(matchKey('INV-123', { prefixes })).toBe('INV123');
  });
});

describe('a number from a file name', () => {
  it('comes after a word that says it is one', () => {
    expect(numberFromFileName('Invoice INV-2026-0042.pdf')).toBe('INV-2026-0042');
    expect(numberFromFileName('march/invoice_no_55120.pdf')).toBe('55120');
  });

  it('is otherwise the piece of the name with the most digits', () => {
    expect(numberFromFileName('104233_PO-9921.pdf')).toBe('104233');
    expect(numberFromFileName('2026-FX-00940.pdf')).toBe('2026-FX-00940');
  });

  it('is nothing when the name has no number', () => {
    expect(numberFromFileName('scan.pdf')).toBeNull();
  });
});

describe('a spreadsheet', () => {
  const rows = [
    ['Open invoices, March'],
    [],
    ['Customer', 'Inv No', 'Amount'],
    ['Lakeshore', 'INV-00123', '10.00'],
    ['Lakeshore', '', '5.00'],
    [],
    ['Harbor & Pine', '456', '7.50'],
  ];

  it('finds the heading row under a title, and the invoice column by its heading', () => {
    expect(guessSheetLayout(rows)).toMatchObject({ headerRow: 2, invoiceColumn: 1 });
  });

  it('gives one entry per invoice with its Excel row and carried-over columns', () => {
    const layout = guessSheetLayout(rows);
    const { entries, blank, problem } = sheetEntries(
      rows,
      { ...layout, carry: [0] },
      layout.headers
    );
    expect(entries).toEqual([
      {
        rowNumber: 4,
        invoice: 'INV-00123',
        extras: { Customer: 'Lakeshore' },
        fields: { customer: 'Lakeshore', amount: '10.00' },
      },
      {
        rowNumber: 7,
        invoice: '456',
        extras: { Customer: 'Harbor & Pine' },
        fields: { customer: 'Harbor & Pine', amount: '7.50' },
      },
    ]);
    expect(blank).toBe(1);
    expect(problem).toBeNull();
  });

  it('says so when the chosen column is empty or not numbers', () => {
    const layout = guessSheetLayout(rows);
    expect(sheetEntries(rows, { ...layout, invoiceColumn: 2 }, layout.headers).problem).toBeNull();
    expect(sheetEntries(rows, { ...layout, invoiceColumn: 0 }, layout.headers).problem).toMatch(
      /does not look like invoice numbers/
    );
    expect(sheetEntries(rows, { ...layout, invoiceColumn: 5 }, layout.headers).problem).toMatch(
      /empty/
    );
  });
});

describe('cross-checking', () => {
  const pdf = (id, invoice, extra = {}) => ({
    id,
    fileName: `${id}.pdf`,
    invoice,
    source: 'text',
    ...extra,
  });
  const row = (rowNumber, invoice) => ({ rowNumber, invoice, extras: {} });

  const result = reconcile(
    [
      pdf('a', 'INV-00123'),
      pdf('b', '555'),
      pdf('c', '777'),
      pdf('d', '777'),
      pdf('e', null, { source: null, problem: 'damaged' }),
      pdf('f', '900', { source: 'filename' }),
    ],
    [row(2, '123'), row(3, '888'), row(4, '900'), row(5, '888')]
  );

  it('sorts every invoice into one of the three sections', () => {
    expect(result.matched.map((entry) => [entry.pdf.id, entry.row.rowNumber])).toEqual([
      ['a', 2],
      ['f', 4],
    ]);
    expect(result.onlyPdf.map((entry) => entry.pdf.id)).toEqual(['b', 'c', 'd']);
    expect(result.onlySheet.map((entry) => entry.row.rowNumber)).toEqual([3, 5]);
    expect(result.unreadable.map((item) => item.id)).toEqual(['e']);
  });

  it('says when a match needed the clean-up, and where a number came from', () => {
    expect(result.matched[0].notes).toContain('Matched after cleanup: INV-00123 and 123');
    expect(result.matched[1].cleanup).toBe(false);
    expect(result.matched[1].notes).toContain('Number taken from the file name');
  });

  it('flags the same number twice on either side, saying where the other is', () => {
    expect(result.onlyPdf.filter((entry) => entry.duplicate).map((entry) => entry.notes)).toEqual([
      ['Duplicate: also in d.pdf'],
      ['Duplicate: also in c.pdf'],
    ]);
    expect(result.onlySheet[0].notes).toEqual(['Duplicate: also on row 5']);
    expect(result.duplicates).toEqual({ pdf: 2, sheet: 2 });
  });
});

describe('the columns the summary reads', () => {
  it('tells an amount due from a due date, and skips the invoice column', () => {
    const headers = [
      'Invoice No',
      'Customer Name',
      'Invoice Date',
      'Due Date',
      'Amount Due',
      'Terms',
      'Status',
      'Currency',
    ];
    expect(guessFieldColumns(headers, 0)).toEqual({
      customer: 1,
      date: 2,
      due: 3,
      amount: 4,
      terms: 5,
      status: 6,
      currency: 7,
    });
  });
});
