/**
 * The summary: one row per invoice, its due date and status, and what is owed.
 */

import { describe, expect, it } from 'vitest';
import { summarize, totalsByCurrency, totalsByCustomer } from '../../src/core/summary.js';

const TODAY = '2026-10-13';

const pdf = (id, invoice, fields) => ({ id, invoice, fields });
const row = (rowNumber, invoice, fields) => ({ rowNumber, invoice, fields });

const usd = (amount, raw = `$${amount}`) => ({ amount, currency: 'USD', raw });

describe('one row per invoice', () => {
  it('works out the due date from the date and terms, and how late it is', () => {
    const [one] = summarize(
      {
        matched: [
          {
            pdf: pdf('a', 'HL-1', {
              customer: 'Lakeshore',
              total: usd(100),
              date: { iso: '2026-09-02', raw: 'Sep 2, 2026' },
              terms: { days: 30, eom: false },
            }),
            row: row(2, 'HL-1', { amount: '100.00', status: 'Open' }),
          },
        ],
        onlyPdf: [],
        onlySheet: [],
      },
      { today: TODAY }
    );
    expect(one).toMatchObject({
      dueIso: '2026-10-02',
      daysLeft: -11,
      status: 'overdue',
      terms: 'Net 30',
      notes: [],
    });
  });

  it('fills what the PDF leaves out from the sheet, reading its dates by the currency', () => {
    const [one] = summarize(
      {
        matched: [
          {
            pdf: pdf('a', 'EU-1', {
              total: { amount: 50, currency: 'EUR', raw: '€50,00' },
            }),
            row: row(2, 'EU-1', { date: '03/10/2026', terms: 'Net 14', customer: 'Müller GmbH' }),
          },
        ],
        onlyPdf: [],
        onlySheet: [],
      },
      { today: TODAY }
    );
    // 3 October, not 10 March: a euro invoice is dated day first.
    expect(one).toMatchObject({
      customer: 'Müller GmbH',
      dateIso: '2026-10-03',
      dueIso: '2026-10-17',
      status: 'soon',
    });
  });

  it('flags a total or a date the PDF and the sheet disagree on', () => {
    const [one] = summarize(
      {
        matched: [
          {
            pdf: pdf('a', 'X-1', {
              total: usd(1297.48, '$1,297.48'),
              date: { iso: '2026-09-02', raw: 'Sep 2, 2026' },
              terms: { days: 30, eom: false },
            }),
            row: row(2, 'X-1', { amount: '1279.48', date: '2026-09-03' }),
          },
        ],
        onlyPdf: [],
        onlySheet: [],
      },
      { today: TODAY }
    );
    expect(one.notes).toEqual([
      'Total differs: PDF $1,297.48, Excel 1279.48',
      'Invoice date differs: PDF Sep 2, 2026, Excel 2026-09-03',
    ]);
  });

  it('leaves a paid invoice out of what is owed', () => {
    const rows = summarize(
      {
        matched: [],
        onlyPdf: [],
        onlySheet: [
          { row: row(2, 'A', { amount: '10.00', due: '2026-09-01', status: 'Paid' }) },
          { row: row(3, 'B', { amount: '20.00', due: '2026-09-01', status: 'Unpaid' }) },
        ],
      },
      { today: TODAY }
    );
    expect(rows.map((one) => one.status)).toEqual(['paid', 'overdue']);
    expect(totalsByCurrency(rows)).toEqual([
      expect.objectContaining({ outstanding: 20, overdue: 20, overdueCount: 1 }),
    ]);
  });
});

describe('totals', () => {
  const rows = [
    { customer: 'A', currency: 'USD', total: 100, status: 'overdue', daysLeft: -5 },
    { customer: 'A', currency: 'USD', total: 50, status: 'open', daysLeft: 20 },
    { customer: 'B', currency: 'EUR', total: 70, status: 'soon', daysLeft: 3 },
    { customer: 'B', currency: 'EUR', total: 30, status: 'paid', daysLeft: -40 },
  ];

  it('keeps each currency apart, and splits each by status and by when it is due', () => {
    const [usd, eur] = totalsByCurrency(rows);
    expect(usd).toMatchObject({
      currency: 'USD',
      outstanding: 150,
      overdue: 100,
      overdueCount: 1,
      byStatus: { overdue: { amount: 100, count: 1 }, open: { amount: 50, count: 1 } },
    });
    expect(Object.fromEntries(usd.buckets.map((bucket) => [bucket.key, bucket.amount]))).toEqual({
      late90: 0,
      late60: 0,
      late30: 0,
      late1: 100,
      week: 0,
      month: 50,
      later: 0,
    });
    expect(eur).toMatchObject({ currency: 'EUR', outstanding: 70, soon: 70, soonCount: 1 });
    expect(eur.buckets.find((bucket) => bucket.key === 'week')).toMatchObject({
      amount: 70,
      count: 1,
    });
  });

  it('puts the customers who are most overdue first', () => {
    expect(totalsByCustomer(rows)).toEqual([
      { customer: 'A', currency: 'USD', open: 2, outstanding: 150, overdue: 100, mostLate: 5 },
      { customer: 'B', currency: 'EUR', open: 1, outstanding: 70, overdue: 0, mostLate: 0 },
    ]);
  });
});
