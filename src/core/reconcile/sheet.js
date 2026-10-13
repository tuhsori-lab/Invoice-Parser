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
    const column = row.findIndex((cell) => INVOICE_HEADING.test(String(cell ?? '').trim()));
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
 * @returns {{ entries: Array<{ rowNumber: number, invoice: string, extras: Record<string, string> }>,
 *   blank: number, problem: string|null }}
 */
export function sheetEntries(rows, choice, headers) {
  const { headerRow, invoiceColumn, carry = [], firstRow = 1 } = choice;
  const entries = [];
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
    entries.push({ rowNumber: firstRow + at, invoice, extras });
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
