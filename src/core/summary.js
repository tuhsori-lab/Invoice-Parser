/**
 * What is owed and when: every invoice sent, from its PDF and its row in the
 * spreadsheet, with when it falls due.
 *
 * The PDF is what the customer received, so its values come first; the sheet
 * fills what the PDF does not say, and where both say something and disagree,
 * the invoice is flagged rather than one side quietly winning. The due date is
 * the one printed on the invoice, or else its date plus its terms.
 */

import {
  dateOrderFor,
  daysBetween,
  dueDateFor,
  parseDate,
  parseMoney,
  parseTerms,
} from './fields.js';

/** Statuses, in the order they sort: what needs chasing first. */
export const SUMMARY_STATUS = {
  overdue: 'Past due',
  soon: 'Due soon',
  open: 'Not due yet',
  unknown: 'No due date',
  paid: 'Paid',
};
export const SUMMARY_ORDER = Object.keys(SUMMARY_STATUS);

/** Days ahead that count as due soon. */
export const SOON_DAYS = 7;

const PAID = /\b(paid|closed|settled|cleared|bezahlt|payé|pagado|betaald|pagato)\b/i;
const NOT_PAID = /\b(un|not|partial|part)\b|unpaid|nicht/i;

/** A currency written in a sheet column: "EUR", "€", "usd". */
function currencyOf(text) {
  const found = parseMoney(`1.00 ${String(text ?? '').trim()}`);
  return found?.currency ?? null;
}

/** An amount from a sheet cell, which may be a plain number. */
function sheetAmount(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return null;
  const money = parseMoney(raw);
  if (money) return money;
  const plain = Number(raw.replace(/,/g, ''));
  return Number.isFinite(plain) ? { amount: plain, currency: null } : null;
}

/** Terms as words again, for the table. */
function termsText(terms) {
  if (!terms) return '';
  if (terms.days === 0) return 'Due on receipt';
  return `Net ${terms.days}${terms.eom ? ' EOM' : ''}`;
}

/**
 * One invoice, from its PDF, its sheet row, or both.
 *
 * @param {object|null} pdf - an item from readInvoicePdfs, with `fields`.
 * @param {object|null} row - a sheet entry, with `fields`.
 * @param {string} today - YYYY-MM-DD.
 */
function summarizeOne(pdf, row, today) {
  const fromPdf = pdf?.fields ?? {};
  const fromSheet = row?.fields ?? {};
  const notes = [];

  const sheetMoney = sheetAmount(fromSheet.amount);
  const currency =
    fromPdf.total?.currency ?? currencyOf(fromSheet.currency) ?? sheetMoney?.currency ?? null;
  const order = dateOrderFor(currency);
  const sheetDate = parseDate(fromSheet.date, order);
  const sheetDue = parseDate(fromSheet.due, order);
  const sheetTerms = parseTerms(fromSheet.terms);

  const total = fromPdf.total?.amount ?? sheetMoney?.amount ?? null;
  const dateIso = fromPdf.date?.iso ?? sheetDate?.iso ?? null;
  const terms = fromPdf.terms ?? sheetTerms;
  const dueIso = fromPdf.due?.iso ?? dueDateFor(dateIso, terms) ?? sheetDue?.iso ?? null;
  const paid = PAID.test(fromSheet.status ?? '') && !NOT_PAID.test(fromSheet.status ?? '');

  if (fromPdf.total && sheetMoney && Math.abs(fromPdf.total.amount - sheetMoney.amount) > 0.005) {
    notes.push(`Total differs: PDF ${fromPdf.total.raw}, Excel ${fromSheet.amount}`);
  }
  if (fromPdf.date && sheetDate && fromPdf.date.iso !== sheetDate.iso) {
    notes.push(`Invoice date differs: PDF ${fromPdf.date.raw}, Excel ${fromSheet.date}`);
  } else if (fromPdf.date?.ambiguous && !sheetDate) {
    notes.push(`Date ${fromPdf.date.raw} could be day or month first`);
  }
  if (sheetDue && dueIso && sheetDue.iso !== dueIso) {
    notes.push(`Due date differs: worked out ${dueIso}, Excel ${fromSheet.due}`);
  }
  if (!pdf) notes.push('No PDF');
  if (!row) notes.push('Not in Excel');
  if (!dueIso && !paid) {
    notes.push(!dateIso ? 'No invoice date found' : 'No terms or due date found');
  }

  let status = 'open';
  const daysLeft = dueIso ? daysBetween(today, dueIso) : null;
  if (paid) status = 'paid';
  else if (daysLeft === null) status = 'unknown';
  else if (daysLeft < 0) status = 'overdue';
  else if (daysLeft <= SOON_DAYS) status = 'soon';

  return {
    id: pdf?.id ?? `row-${row.rowNumber}`,
    invoice: pdf?.invoice ?? row?.invoice,
    customer: fromPdf.customer ?? (fromSheet.customer || null),
    currency,
    total,
    dateIso,
    terms: termsText(terms),
    dueIso,
    daysLeft,
    status,
    notes,
    pdf,
    rowNumber: row?.rowNumber ?? null,
  };
}

/**
 * Every invoice with a number, from a reconcile() result.
 *
 * @param {ReturnType<import('./reconcile/match.js').reconcile>} result
 * @param {{ today: string }} options - today as YYYY-MM-DD.
 * @returns {Array<ReturnType<typeof summarizeOne>>}
 */
export function summarize(result, { today }) {
  return [
    ...result.matched.map((entry) => summarizeOne(entry.pdf, entry.row, today)),
    ...result.onlyPdf.map((entry) => summarizeOne(entry.pdf, null, today)),
    ...result.onlySheet.map((entry) => summarizeOne(null, entry.row, today)),
  ];
}

/**
 * Money owed, per currency: dollars and euros are never added together.
 *
 * @param {Array<object>} rows - from summarize.
 * @returns {Array<{ currency: string|null, outstanding: number, overdue: number,
 *   soon: number, open: number, overdueCount: number, soonCount: number,
 *   byStatus: Record<string, { amount: number, count: number }>,
 *   buckets: ReturnType<typeof dueBuckets> }>}
 */
export function totalsByCurrency(rows) {
  const by = new Map();
  for (const row of rows) {
    if (row.status === 'paid' || row.total === null) continue;
    const key = row.currency;
    if (!by.has(key)) {
      by.set(key, {
        currency: key,
        outstanding: 0,
        overdue: 0,
        soon: 0,
        open: 0,
        overdueCount: 0,
        soonCount: 0,
        byStatus: Object.fromEntries(
          ['overdue', 'soon', 'open', 'unknown'].map((status) => [status, { amount: 0, count: 0 }])
        ),
        rows: [],
      });
    }
    const sum = by.get(key);
    sum.outstanding += row.total;
    sum.open += 1;
    sum.byStatus[row.status].amount += row.total;
    sum.byStatus[row.status].count += 1;
    sum.rows.push(row);
    if (row.status === 'overdue') {
      sum.overdue += row.total;
      sum.overdueCount += 1;
    } else if (row.status === 'soon') {
      sum.soon += row.total;
      sum.soonCount += 1;
    }
  }
  return [...by.values()]
    .map(({ rows: owed, ...sum }) => ({ ...sum, buckets: dueBuckets(owed) }))
    .sort((a, b) => b.outstanding - a.outstanding);
}

/**
 * Spans of days from today that unpaid invoices fall due in: the usual 30/60/90
 * aging on the late side, and what is coming in on the other.
 */
export const DUE_BUCKETS = [
  { key: 'late90', label: '90+ late', from: -Infinity, to: -91, status: 'overdue' },
  { key: 'late60', label: '61–90 late', from: -90, to: -61, status: 'overdue' },
  { key: 'late30', label: '31–60 late', from: -60, to: -31, status: 'overdue' },
  { key: 'late1', label: '1–30 late', from: -30, to: -1, status: 'overdue' },
  { key: 'week', label: 'Next 7 days', from: 0, to: 7, status: 'soon' },
  { key: 'month', label: '8–30 days', from: 8, to: 30, status: 'open' },
  { key: 'later', label: '31+ days', from: 31, to: Infinity, status: 'open' },
];

/**
 * How much falls due in each span, for the invoices with a due date.
 *
 * @param {Array<object>} rows - unpaid rows of one currency, from summarize.
 * @returns {Array<{ key: string, label: string, status: string, amount: number, count: number }>}
 */
export function dueBuckets(rows) {
  return DUE_BUCKETS.map(({ key, label, from, to, status }) => {
    const inside = rows.filter(
      (row) => row.daysLeft !== null && row.daysLeft >= from && row.daysLeft <= to
    );
    return {
      key,
      label,
      status,
      amount: inside.reduce((sum, row) => sum + (row.total ?? 0), 0),
      count: inside.length,
    };
  });
}

/**
 * What each customer owes, per currency, with how late their oldest invoice is.
 *
 * @param {Array<object>} rows - from summarize.
 */
export function totalsByCustomer(rows) {
  const by = new Map();
  for (const row of rows) {
    if (row.status === 'paid') continue;
    const key = `${row.customer ?? ''}|${row.currency ?? ''}`;
    if (!by.has(key)) {
      by.set(key, {
        customer: row.customer ?? 'Unknown customer',
        currency: row.currency,
        open: 0,
        outstanding: 0,
        overdue: 0,
        mostLate: 0,
      });
    }
    const sum = by.get(key);
    sum.open += 1;
    sum.outstanding += row.total ?? 0;
    if (row.status === 'overdue') {
      sum.overdue += row.total ?? 0;
      sum.mostLate = Math.max(sum.mostLate, -row.daysLeft);
    }
  }
  return [...by.values()].sort((a, b) => b.overdue - a.overdue || b.outstanding - a.outstanding);
}
