/**
 * The report of what is missing. Every number here is invented.
 */

import { describe, expect, it } from 'vitest';
import { buildKnownList, guessColumns } from '../../src/core/knownList.js';
import { REPORT_COLUMNS, buildReport, countReport } from '../../src/core/report.js';
import { buildReportCsv } from '../../src/core/export.js';

const invoice = (number, pages, po = '', extra = {}) => ({
  invoice: number,
  pages: pages.map((index) => ({ index })),
  po: po ? { value: po, label: 'PO #' } : null,
  flags: [],
  ...extra,
});

const rows = [
  ['Invoice No', 'Customer', 'PO Number'],
  ['664120', 'Lakeshore Supply', 'PO-5512'],
  ['664121', 'Lakeshore Supply', 'PO-5513'],
  ['664122', 'Harbor & Pine', 'PO-5514'],
];
const list = buildKnownList(rows, guessColumns(rows), 'open-invoices.csv');

describe('the invoice list with POs', () => {
  it('finds the PO column by its heading', () => {
    expect(guessColumns(rows)).toMatchObject({ invoiceColumn: 0, clientColumn: 1, poColumn: 2 });
    expect(list.hasPo).toBe(true);
    expect(list.byValue.get('664121').po).toBe('PO-5513');
  });

  it('does not take a plain "Order" column for POs', () => {
    expect(
      guessColumns([
        ['Invoice', 'Order'],
        ['1001', '77'],
      ]).poColumn
    ).toBeNull();
  });
});

describe('what is missing', () => {
  const batch = [
    invoice('664120', [1, 2], 'PO-5512'),
    invoice('664121', [3], 'PO-5599'),
    invoice('664199', [4], ''),
    invoice(null, [5]),
  ];
  const missing = [{ value: '664122', client: 'Harbor & Pine' }];
  const report = buildReport(batch, { knownList: list, missing });

  it('has a row for each thing to chase, grouped by kind', () => {
    expect(report.map((row) => [row.kind, row.cells[1]])).toEqual([
      ['missing-from-batch', '664122'],
      ['not-in-list', '664199'],
      ['no-number', ''],
      ['po-not-found', '664199'],
      ['po-not-found', ''],
      ['po-different', '664121'],
    ]);
  });

  it('says in each row what it is, with the PO both ways where there is one', () => {
    const row = (kind) => report.find((entry) => entry.kind === kind).cells;
    expect(row('missing-from-batch')).toEqual([
      'In your list, not in this batch',
      '664122',
      '',
      '',
      'PO-5514',
      'Harbor & Pine',
      '',
    ]);
    expect(row('po-different')).toEqual([
      'PO is not the one in your list',
      '664121',
      '3',
      'PO-5599',
      'PO-5513',
      'Lakeshore Supply',
      '',
    ]);
  });

  it('counts each kind', () => {
    expect(countReport(report)).toEqual({
      'missing-from-batch': 1,
      'not-in-list': 1,
      'no-number': 1,
      'po-not-found': 2,
      'po-different': 1,
    });
  });

  it('suggests the list entry an invoice is close to', () => {
    const near = buildReport([invoice('664l20', [1], 'PO-5512')], { knownList: list });
    expect(near.find((row) => row.kind === 'not-in-list').cells[6]).toBe(
      'Close to 664120 in your list'
    );
  });

  it('says a PO was not read when only parts of a scan were', () => {
    const scan = invoice('664120', [1]);
    scan.pages[0].partial = true;
    const row = buildReport([scan], { knownList: list }).find(
      (entry) => entry.kind === 'po-not-found'
    );
    expect(row.cells[6]).toMatch(/^Not read/);
  });

  it('without a list, still lists pages with no number and POs not found', () => {
    expect(buildReport(batch).map((row) => row.kind)).toEqual([
      'no-number',
      'po-not-found',
      'po-not-found',
    ]);
  });

  it('treats POs written a little differently as the same', () => {
    for (const written of ['po 5512', 'PO5512', '5512', 'PO-5512']) {
      const same = buildReport([invoice('664120', [1], written)], { knownList: list });
      expect(same.find((row) => row.kind === 'po-different')).toBeUndefined();
    }
    const other = buildReport([invoice('664120', [1], 'PO-5521')], { knownList: list });
    expect(other.find((row) => row.kind === 'po-different')).toBeDefined();
  });
});

describe('the report as a spreadsheet', () => {
  it('has a heading row, quotes what needs quoting, and opens in Excel', () => {
    const csv = buildReportCsv(
      buildReport([invoice('664122', [2, 3])], {
        knownList: list,
        missing: [{ value: '664121', client: 'Lakeshore Supply' }],
      }),
      REPORT_COLUMNS
    );
    const lines = csv
      .replace(/^\uFEFF/, '')
      .trim()
      .split('\r\n');
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(lines[0]).toBe('What,Invoice,Pages,PO on the invoice,PO in your list,Client,Note');
    expect(lines[1]).toBe('"In your list, not in this batch",664121,,,PO-5513,Lakeshore Supply,');
    expect(lines[2]).toBe('No PO found,664122,2 to 3,,PO-5514,Harbor & Pine,');
  });
});
