/**
 * Opening the invoice list a person exported from their accounting system.
 *
 * A CSV is read as plain text, so "00123" stays "00123". An Excel workbook -
 * .xlsx, or an older .xls - is read with SheetJS, cells as Excel shows them.
 * Both happen in this browser tab; the file goes nowhere. The rows are kept in
 * memory for this session only and never saved.
 */

import { parseCsv } from '../core/knownList.js';
import { isSheetFile, readWorkbook, SheetFileError } from './sheets.js';

/** A problem with the file, said in words a person can act on. */
export class ListFileError extends Error {}

/**
 * Read a list file into rows of cells: a CSV, or the first sheet of an Excel
 * file with anything in it (.xlsx, .xls and the like, read by SheetJS).
 *
 * @param {File} file
 * @returns {Promise<string[][]>}
 */
export async function readListFile(file) {
  if (!isSheetFile(file) || /\.(csv|tsv|txt)$/i.test(file.name)) {
    // Plain text, comma-separated: read as it is written.
    return parseCsv(await file.text());
  }
  let sheets;
  try {
    sheets = await readWorkbook(file);
  } catch (error) {
    throw new ListFileError(
      error instanceof SheetFileError ? error.message : 'This file could not be read.'
    );
  }
  const sheet = sheets.find((entry) => entry.rows.some((row) => row.some((cell) => cell.trim())));
  if (!sheet) throw new ListFileError('No worksheet with anything in it was found in this file.');
  // Blank rows say nothing about invoices.
  return sheet.rows.filter((row) => row.some((cell) => cell.trim()));
}
