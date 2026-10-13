/**
 * Cross-checking invoice PDFs against a spreadsheet, both ways.
 *
 * Every PDF and every sheet row is reduced to its cleaned-up number (see
 * normalize.js) and the two sides are lined up on it:
 *
 * - in the PDFs, not in the sheet - a file somebody has that the sheet lacks;
 * - in the sheet, not in the PDFs - an invoice somebody is missing the file for;
 * - matched - on both, shown with both numbers as written.
 *
 * The same number twice on one side - two files, or two rows - is flagged on
 * every one of them, with where the other copy is. So is a match that needed
 * the clean-up: "INV-00123" and "123" match, and the person is told why.
 * Files whose number could not be found at all are kept apart, never matched.
 */

import { matchKey, writtenDifferently } from './normalize.js';

/**
 * @typedef {object} PdfItem
 * @property {string} id
 * @property {string} fileName
 * @property {string} [path] - folder and name, for a file from a dropped folder.
 * @property {string|null} invoice - as found, or null.
 * @property {'text'|'filename'|'scan'|null} source - where the number came from.
 * @property {string[]} [others] - other invoice numbers found in the same file.
 * @property {string|null} [problem] - why the file could not be read.
 */

/**
 * @typedef {object} SheetEntry
 * @property {number} rowNumber - as Excel shows it.
 * @property {string} invoice - as written.
 * @property {Record<string, string>} extras - the columns carried over.
 */

/**
 * @param {PdfItem[]} pdfs
 * @param {SheetEntry[]} entries
 * @param {{ prefixes?: string[] }} [options]
 * @returns {{
 *   onlyPdf: Array<object>, onlySheet: Array<object>, matched: Array<object>,
 *   unreadable: PdfItem[], duplicates: { pdf: number, sheet: number },
 * }}
 */
export function reconcile(pdfs = [], entries = [], options = {}) {
  const byKey = new Map();
  const slot = (key) => {
    if (!byKey.has(key)) byKey.set(key, { pdfs: [], rows: [] });
    return byKey.get(key);
  };

  const unreadable = [];
  for (const pdf of pdfs) {
    const key = pdf.invoice ? matchKey(pdf.invoice, options) : '';
    if (!key) unreadable.push(pdf);
    else slot(key).pdfs.push(pdf);
  }
  for (const entry of entries) {
    const key = matchKey(entry.invoice, options);
    if (key) slot(key).rows.push(entry);
  }

  const onlyPdf = [];
  const onlySheet = [];
  const matched = [];
  let pdfDuplicates = 0;
  let sheetDuplicates = 0;

  for (const [key, { pdfs: files, rows }] of byKey) {
    if (files.length > 1) pdfDuplicates += files.length;
    if (rows.length > 1) sheetDuplicates += rows.length;
    const fileNotes = (pdf) => notesForPdf(pdf, files);
    const rowNotes = (row) => notesForRow(row, rows);

    if (files.length && rows.length) {
      for (const pdf of files) {
        const row = rows[0];
        const notes = [...fileNotes(pdf), ...rowNotes(row)];
        if (writtenDifferently(pdf.invoice, row.invoice)) {
          notes.unshift(`Matched after cleanup: ${pdf.invoice} and ${row.invoice}`);
        }
        matched.push({
          key,
          pdf,
          row,
          rows,
          cleanup: writtenDifferently(pdf.invoice, row.invoice),
          duplicate: files.length > 1 || rows.length > 1,
          notes,
        });
      }
    } else if (files.length) {
      for (const pdf of files) {
        onlyPdf.push({ key, pdf, duplicate: files.length > 1, notes: fileNotes(pdf) });
      }
    } else {
      for (const row of rows) {
        onlySheet.push({ key, row, duplicate: rows.length > 1, notes: rowNotes(row) });
      }
    }
  }

  return {
    onlyPdf,
    onlySheet,
    matched,
    unreadable,
    duplicates: { pdf: pdfDuplicates, sheet: sheetDuplicates },
  };
}

/** What to say about a file: where its number came from, and any copies. */
function notesForPdf(pdf, sameNumber) {
  const notes = [];
  if (pdf.source === 'filename') notes.push('Number taken from the file name');
  if (pdf.source === 'scan') notes.push('Read from a scan');
  if (pdf.others?.length) notes.push(`This file also has ${pdf.others.join(', ')}`);
  const copies = sameNumber.filter((other) => other !== pdf);
  if (copies.length) {
    notes.push(
      `Duplicate: also in ${copies.map((other) => other.path || other.fileName).join(', ')}`
    );
  }
  return notes;
}

/** What to say about a sheet row: any other rows with the same number. */
function notesForRow(row, sameNumber) {
  const copies = sameNumber.filter((other) => other !== row);
  if (!copies.length) return [];
  const where = copies.map((other) => other.rowNumber);
  return [`Duplicate: also on row${where.length === 1 ? '' : 's'} ${where.join(', ')}`];
}
