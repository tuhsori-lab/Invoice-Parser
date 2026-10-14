/**
 * Reading the rest of an invoice: customer, date, terms, due date and total.
 *
 * The parsers are tested one by one, then all together on a few hundred
 * made-up invoices that vary everything an invoicing system varies - labels,
 * where values sit, US and EU dates, currencies, terms - each built from text
 * pieces placed the way pdf.js hands them over, with the right answer known.
 */

import { describe, expect, it } from 'vitest';
import { buildPageText } from '../../src/core/extractText.js';
import {
  dueDateFor,
  parseDate,
  parseMoney,
  parseTerms,
  readFields,
} from '../../src/core/fields.js';

describe('money', () => {
  it.each([
    ['$1,297.48', 1297.48, 'USD'],
    ['€1.297,48', 1297.48, 'EUR'],
    ['1.297,48 €', 1297.48, 'EUR'],
    ['1 297,48 EUR', 1297.48, 'EUR'],
    ['EUR 1,297.48', 1297.48, 'EUR'],
    ['£45.00', 45, 'GBP'],
    ['1,297.48', 1297.48, null],
    ['$1,297', 1297, 'USD'],
    ['(45.00)', -45, null],
    ["CHF 1'297.50", 1297.5, 'CHF'],
  ])('reads %s', (raw, amount, currency) => {
    expect(parseMoney(raw)).toEqual({ amount, currency });
  });

  it.each(['7', 'Net 30', 'HL-24017', ''])('does not take %j for money', (raw) => {
    expect(parseMoney(raw)).toBeNull();
  });
});

describe('dates', () => {
  it.each([
    ['2026-09-02', null, '2026-09-02', false],
    ['Sep 2, 2026', null, '2026-09-02', false],
    ['September 2nd, 2026', null, '2026-09-02', false],
    ['2 Sep 2026', null, '2026-09-02', false],
    ['02-Sep-2026', null, '2026-09-02', false],
    ['2. September 2026', null, '2026-09-02', false],
    ['2 sept. 2026', null, '2026-09-02', false],
    ['02.09.2026', null, '2026-09-02', false],
    ['25/03/2026', null, '2026-03-25', false],
    ['03/25/2026', null, '2026-03-25', false],
    ['03/04/2026', 'mdy', '2026-03-04', false],
    ['03/04/2026', 'dmy', '2026-04-03', false],
    ['03/04/2026', null, '2026-03-04', true],
    ['04/04/26', null, '2026-04-04', false],
    ['Oct1, 2026', null, '2026-10-01', false],
  ])('reads %s (%s)', (raw, order, iso, ambiguous) => {
    expect(parseDate(raw, order)).toEqual({ iso, ambiguous });
  });

  it('turns down a day that does not exist', () => {
    expect(parseDate('31/02/2026')).toBeNull();
  });
});

describe('terms', () => {
  it.each([
    ['Net 30', 30, false],
    ['NET30', 30, false],
    ['N45', 45, false],
    ['2/10 Net 30', 30, false],
    ['Net 30 EOM', 30, true],
    ['30 days', 30, false],
    ['Payment within 14 days', 14, false],
    ['Due on receipt', 0, false],
    ['30 Tage netto', 30, false],
  ])('reads %s', (raw, days, eom) => {
    expect(parseTerms(raw)).toEqual({ days, eom });
  });

  it('counts EOM terms from the end of the month', () => {
    expect(dueDateFor('2026-01-15', { days: 30, eom: true })).toBe('2026-03-02');
    expect(dueDateFor('2026-12-20', { days: 30, eom: false })).toBe('2027-01-19');
  });
});

/* ------------------------------------------------------- made-up invoices */

/** A small repeatable random generator (mulberry32). */
function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One piece of drawn text, as pdf.js gives it: x from the left, y from the bottom. */
const item = (str, x, y, size = 10) => ({
  str,
  transform: [size, 0, 0, size, x, y],
  width: str.length * size * 0.52,
  height: size,
  hasEOL: false,
});

const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const pad = (n) => String(n).padStart(2, '0');

/** A date written as a US or an EU invoicing system might. */
function writeDate(pick, [y, m, d], currency) {
  const eu = currency !== 'USD';
  const ways = [
    `${y}-${pad(m)}-${pad(d)}`,
    `${MONTH[m - 1]} ${d}, ${y}`,
    `${LONG[m - 1]} ${d}, ${y}`,
    `${d} ${MONTH[m - 1]} ${y}`,
    `${pad(d)}-${MONTH[m - 1]}-${y}`,
    eu ? `${pad(d)}/${pad(m)}/${y}` : `${pad(m)}/${pad(d)}/${y}`,
    eu ? `${pad(d)}.${pad(m)}.${y}` : `${m}/${d}/${y}`,
  ];
  return pick(ways);
}

/** An amount written in a currency's own way. */
function writeMoney(pick, amount, currency) {
  const [whole, cents] = amount.toFixed(2).split('.');
  const us = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const eu = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  if (currency === 'USD')
    return pick([`$${us}.${cents}`, `USD ${us}.${cents}`, `$ ${us}.${cents}`]);
  if (currency === 'GBP') return pick([`£${us}.${cents}`, `GBP ${us}.${cents}`]);
  return pick([`€${eu},${cents}`, `${eu},${cents} €`, `EUR ${us}.${cents}`, `€ ${us}.${cents}`]);
}

const TERMS = [
  ['Net 30', 30, false],
  ['Net 45', 45, false],
  ['Net 15', 15, false],
  ['NET 60', 60, false],
  ['Due on receipt', 0, false],
  ['30 days', 30, false],
  ['2/10 Net 30', 30, false],
  ['Net 30 EOM', 30, true],
  ['14 days net', 14, false],
];
const CUSTOMERS = [
  'Lakeshore Cafe Group',
  'Atlas Fitness Ltd',
  'Bäckerei Müller GmbH',
  'Société Lumière SARL',
  'Pinecrest Dental',
  'Van Dijk & Zonen B.V.',
];

/**
 * One made-up invoice: its pages as pdf.js items, and what is true of it.
 */
function makeInvoice(seed) {
  const random = seeded(seed);
  const pick = (list) => list[Math.floor(random() * list.length)];
  const currency = pick(['USD', 'USD', 'EUR', 'EUR', 'GBP']);
  const date = [2026, 1 + Math.floor(random() * 12), 1 + Math.floor(random() * 28)];
  const amount = Math.round((50 + random() * 9000) * 100) / 100;
  const [termsText, days, eom] = pick(TERMS);
  const customer = pick(CUSTOMERS);
  const twoPages = random() < 0.3;
  const explicitDue = random() < 0.25;
  const style = pick(['beside', 'together', 'headings']);
  const termsInFooter = random() < 0.2;

  const dateIso = `${date[0]}-${pad(date[1])}-${pad(date[2])}`;
  const dueIso = dueDateFor(dateIso, { days, eom });
  const [dy, dm, dd] = dueIso.split('-').map(Number);

  const page1 = [item('Acme Invoicing Ltd', 56, 740, 18), item('INVOICE', 420, 740, 16)];
  const shout = random() < 0.3;
  const label = (text) => (shout ? text.toUpperCase() : text);
  const colon = random() < 0.8 ? ':' : '';
  const fields = [
    [pick(['Invoice No.', 'Invoice #', 'Invoice Number']), `INV-${seed}`],
    [
      pick(['Invoice Date', 'Date', 'Date of issue', 'Issue Date']),
      writeDate(pick, date, currency),
    ],
  ];
  if (!termsInFooter) fields.push([pick(['Terms', 'Payment Terms']), termsText]);
  if (explicitDue)
    fields.push([pick(['Due Date', 'Payment Due']), writeDate(pick, [dy, dm, dd], currency)]);

  if (style === 'headings') {
    // Headings across the page, the values under them.
    fields.forEach(([name, value], at) => {
      page1.push(item(label(name), 56 + at * 125, 690, 8.5), item(value, 56 + at * 125, 676, 10));
    });
    page1.push(
      item(label(pick(['Bill To', 'Billed to', 'Customer'])), 56, 630, 9),
      item(customer, 56, 616)
    );
  } else {
    const billTo = label(pick(['Bill To', 'Billed to', 'Invoice to', 'Customer']));
    if (style === 'together') page1.push(item(`${billTo}: ${customer}`, 56, 690, 9));
    else page1.push(item(`${billTo}${colon}`, 56, 690, 9), item(customer, 56, 676));
    page1.push(item('12 Long Street, Springfield', 56, 662, 9));
    fields.forEach(([name, value], at) => {
      const y = 690 - at * 15;
      if (style === 'together') page1.push(item(`${label(name)}${colon} ${value}`, 360, y, 9.5));
      else page1.push(item(`${label(name)}${colon}`, 360, y, 9.5), item(value, 455, y, 9.5));
    });
  }

  page1.push(item('Description', 56, 520, 9), item('Amount', 480, 520, 9));
  page1.push(
    item('Consulting services', 56, 500),
    item(writeMoney(pick, amount * 0.6, currency), 480, 500)
  );
  const totals = twoPages ? [] : page1;
  const page2 = twoPages
    ? [item('Acme Invoicing Ltd', 56, 740, 18), item(`Invoice No. INV-${seed}`, 360, 700, 9.5)]
    : null;
  const last = page2 ?? totals;
  // A subtotal, a tax line and a count, all labelled "total" one way or another.
  last.push(item('Subtotal', 380, 300), item(writeMoney(pick, amount / 1.2, currency), 480, 300));
  last.push(
    item(pick(['Total VAT', 'Tax', 'Total tax']), 380, 285),
    item(writeMoney(pick, amount - amount / 1.2, currency), 480, 285)
  );
  last.push(item('Total items: 3', 56, 285, 9));
  last.push(
    item(
      label(
        pick([
          'Total',
          'Total Due',
          'Amount Due',
          'Balance Due',
          'Grand Total',
          `Total (${currency})`,
        ])
      ),
      380,
      260,
      11
    )
  );
  last.push(item(writeMoney(pick, amount, currency), 480, 260, 11));
  if (termsInFooter) {
    // "Within N days" can only stand for plain terms, not end-of-month ones.
    const sentences = [`Payment terms: ${termsText}.`];
    if (!eom && days > 0) sentences.push(`Please pay within ${days} days.`);
    last.push(item(pick(sentences), 56, 120, 8.5));
  }
  // Footer wording that starts like a label.
  last.push(item('Due to bank holidays, transfers may take 3 days.', 56, 100, 8));
  last.push(item('Total hours are billed in 15 minute steps.', 56, 88, 8));

  const pages = [page1, page2].filter(Boolean).map((items) => {
    const { text, layout } = buildPageText(items);
    return { text, layout };
  });
  return {
    pages,
    truth: {
      customer,
      date: dateIso,
      amount,
      currency: currency,
      // A footer sentence "within N days" stands for terms, and 0 days reads as 30 there.
      days: termsInFooter && days === 0 ? null : days,
      dueDate: termsInFooter && days === 0 ? null : dueIso,
    },
  };
}

describe('text read from a scan', () => {
  it('reads labels and dates that lost a space', () => {
    const { text, layout } = buildPageText([
      item('Date: Oct1, 2026', 360, 690),
      item('Terms: . Net30', 360, 675),
      item('Totaldue', 380, 260),
      item('$169.13', 480, 260),
    ]);
    expect(readFields([{ text, layout }])).toMatchObject({
      date: { iso: '2026-10-01' },
      terms: { days: 30 },
      total: { amount: 169.13, currency: 'USD' },
      dueDate: '2026-10-31',
    });
  });
});

describe('reading whole invoices', () => {
  const invoices = Array.from({ length: 1000 }, (_, n) => makeInvoice(1000 + n));

  it('reads every field of a few hundred varied invoices', () => {
    const misses = [];
    for (const [n, { pages, truth }] of invoices.entries()) {
      const read = readFields(pages);
      const check = (field, got, want) => {
        if (want !== null && got !== want)
          misses.push(`#${1000 + n} ${field}: got ${got}, want ${want}`);
      };
      check('customer', read.customer, truth.customer);
      check('date', read.date?.iso, truth.date);
      check('total', read.total?.amount, truth.amount);
      check('currency', read.total?.currency, truth.currency);
      if (truth.days !== null && !(truth.days === 0 && read.terms === null)) {
        check('terms', read.terms?.days, truth.days);
      }
      check('due', read.dueDate, truth.dueDate);
    }
    expect(misses.slice(0, 25)).toEqual([]);
  });
});
