/**
 * Reading the invoice numbers out of a spreadsheet's rows.
 *
 * The heading row is not always the first: exports often start with a title, a
 * date range and a blank line. So the first ten rows are searched for a heading
 * that names the invoice number - "Invoice", "Invoice #", "Inv No" - and the
 * rows under it are the invoices.
 */

import { guessColumns } from '../knownList.js';

/** A heading that names the invoice number column. */
const INVOICE_HEADING =
  /\b(invoice|inv|bill|document|doc)\b|^(invoice|inv)\s*(#|no\.?|nr\.?|number)/i;

/** "InvAmnt", "PONum", "Inv_Amount", "INV.DATE" as words: "Inv Amnt", "PO Num", "Inv Amount", "INV DATE". */
export function headingWords(heading) {
  return String(heading ?? '')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2') // "PONum" is "PO Num"
    .replace(/[_.]+/g, ' ')
    .trim();
}

/** Headings that name an amount, in full or cut short: "Amount", "InvAmnt", "Amt", "Total". */
const AMOUNT_WORDS =
  /\b(amount|amnt|amt|total|balance|value|sum|gross|betrag|montant|importe|bedrag)\b/i;

/**
 * Headings of the columns the summary reads, tried in this order so "Amount
 * due" is an amount and "Due date" a due date.
 */
const FIELD_HEADINGS = [
  ['amount', AMOUNT_WORDS],
  ['due', /due|fällig|échéance|vencimiento|vervaldatum/i],
  ['date', /date|datum|fecha|\bdata\b|issued/i],
  ['terms', /terms|condition|zahlungsziel/i],
  ['customer', /customer|client|bill to|account|company|kunde|debtor|buyer|\bname\b/i],
  ['status', /status|paid|\bstate\b|settled/i],
  ['currency', /currency|\bccy\b|\bcurr\b|währung|devise|moneda/i],
  // Last, so "PO Amount" is an amount; "PO Number", "Purchase order", "Order #" are POs.
  ['po', /\bp\.?\s?o\.?\b(?!\s*box)|purchase\s*order|order\s*(no|number|#|ref)|bestell/i],
];

/**
 * Which column holds each field the summary reads, by its heading.
 *
 * @param {string[]} headers
 * @param {number} invoiceColumn - never one of them.
 * @returns {Record<string, number>} only the fields a column was found for.
 */
export function guessFieldColumns(headers = [], invoiceColumn = -1) {
  const columns = {};
  headers.forEach((heading, column) => {
    if (column === invoiceColumn) return;
    const words = headingWords(heading);
    const field = FIELD_HEADINGS.find(
      ([name, pattern]) => !(name in columns) && pattern.test(words)
    );
    if (field) columns[field[0]] = column;
  });
  return columns;
}

/** How far down a heading row is looked for. */
const HEADER_SEARCH = 10;

/**
 * Where the headings are, and which column holds the invoice numbers.
 *
 * @param {string[][]} rows - every row of the sheet, blank ones included.
 * @returns {{ headerRow: number, invoiceColumn: number, headers: string[] }}
 *   headerRow is -1 when there is no heading row at all.
 */
export function guessSheetLayout(rows = []) {
  for (let at = 0; at < Math.min(HEADER_SEARCH, rows.length); at += 1) {
    const row = rows[at] ?? [];
    // "InvAmnt" and "Inv Date" name the invoice, but hold its amount and date, not its number.
    const column = row.findIndex((cell) => {
      const words = headingWords(cell);
      return (
        INVOICE_HEADING.test(words) && !AMOUNT_WORDS.test(words) && !/\b(date|dt)\b/i.test(words)
      );
    });
    if (column >= 0) {
      return { headerRow: at, invoiceColumn: column, headers: headersOf(rows, at) };
    }
  }
  const guess = guessColumns(rows.filter((row) => row.some((cell) => String(cell ?? '').trim())));
  const headerRow = guess.hasHeader
    ? rows.findIndex((row) => row.some((cell) => String(cell ?? '').trim()))
    : -1;
  return { headerRow, invoiceColumn: guess.invoiceColumn, headers: headersOf(rows, headerRow) };
}

/** The name of every column: its heading, or "Column C" where there is none. */
export function headersOf(rows, headerRow) {
  const width = Math.max(0, ...rows.map((row) => row.length));
  const letters = (column) => {
    let name = '';
    for (let n = column + 1; n > 0; n = Math.floor((n - 1) / 26)) {
      name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
    }
    return name;
  };
  return Array.from({ length: width }, (_, column) => {
    const heading = headerRow >= 0 ? String(rows[headerRow]?.[column] ?? '').trim() : '';
    return heading || `Column ${letters(column)}`;
  });
}

/**
 * The invoices in a sheet: one entry per row with something in the invoice
 * column, with its row number as Excel shows it and the columns carried over.
 *
 * @param {string[][]} rows
 * @param {{ headerRow: number, invoiceColumn: number, carry?: number[], firstRow?: number }} choice
 *   firstRow is the sheet row the first of `rows` is on, counting from 1.
 * @param {string[]} headers
 * @returns {{ entries: Array<{ rowNumber: number, invoice: string, extras: Record<string, string>,
 *   fields: Record<string, string> }>,
 *   blank: number, problem: string|null }}
 */
export function sheetEntries(rows, choice, headers) {
  const { headerRow, invoiceColumn, carry = [], firstRow = 1 } = choice;
  const entries = [];
  const fieldColumns = guessFieldColumns(headers, invoiceColumn);
  let blank = 0;
  for (let at = headerRow + 1; at < rows.length; at += 1) {
    const row = rows[at] ?? [];
    if (!row.some((cell) => String(cell ?? '').trim())) continue;
    const invoice = String(row[invoiceColumn] ?? '').trim();
    if (!invoice) {
      blank += 1;
      continue;
    }
    const extras = {};
    for (const column of carry) extras[headers[column]] = String(row[column] ?? '').trim();
    const fields = {};
    for (const [field, column] of Object.entries(fieldColumns)) {
      fields[field] = String(row[column] ?? '').trim();
    }
    entries.push({ rowNumber: firstRow + at, invoice, extras, fields });
  }

  let problem = null;
  if (entries.length === 0) {
    problem = 'This column is empty. Choose the column that holds the invoice numbers.';
  } else if (entries.filter((entry) => /\d/.test(entry.invoice)).length < entries.length / 2) {
    problem =
      'Most of this column has no digits in it, so it does not look like invoice numbers. Check it is the right column.';
  }
  return { entries, blank, problem };
}
