/**
 * Opening the invoice list a person exported from their accounting system.
 *
 * A CSV is read as text. An Excel workbook (.xlsx) is a ZIP of XML files: it is
 * unzipped here with the same JSZip the app already uses for its own ZIPs, and
 * the first worksheet handed to the engine to read. Both happen in this browser
 * tab; the file goes nowhere. The rows are kept in memory for this session only
 * and never saved.
 */

import { parseCsv, rowsFromSpreadsheetXml } from '../core/knownList.js';

/** A problem with the file, said in words a person can act on. */
export class ListFileError extends Error {}

/** The first worksheet's path inside the workbook, as the workbook itself says. */
async function firstSheetPath(zip) {
  const workbook = await zip.file('xl/workbook.xml')?.async('string');
  const rels = await zip.file('xl/_rels/workbook.xml.rels')?.async('string');
  const id = workbook && /<sheet\b[^>]*\br:id="([^"]+)"/.exec(workbook)?.[1];
  // Each relationship's attributes can come in any order.
  const target = [...String(rels ?? '').matchAll(/<Relationship\b([^>]*)\/?>/g)]
    .map((match) => match[1])
    .filter((attributes) => /\bId="([^"]+)"/.exec(attributes)?.[1] === id)
    .map((attributes) => /\bTarget="([^"]+)"/.exec(attributes)?.[1])[0];
  if (!target) return 'xl/worksheets/sheet1.xml';
  return target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
}

/**
 * Read a list file into rows of cells.
 *
 * @param {File} file
 * @returns {Promise<string[][]>}
 */
export async function readListFile(file) {
  const name = String(file?.name ?? '').toLowerCase();
  if (name.endsWith('.xls')) {
    throw new ListFileError(
      'This is an older Excel file (.xls). Open it in Excel and save it as .xlsx or .csv, then load that.'
    );
  }
  if (name.endsWith('.xlsx')) {
    const { default: JSZip } = await import('jszip');
    let zip;
    try {
      zip = await JSZip.loadAsync(await file.arrayBuffer());
    } catch {
      throw new ListFileError('This Excel file could not be opened. Try saving it again as .csv.');
    }
    const sheet = await zip.file(await firstSheetPath(zip))?.async('string');
    if (!sheet) throw new ListFileError('No worksheet was found in this Excel file.');
    const sharedStrings = (await zip.file('xl/sharedStrings.xml')?.async('string')) ?? '';
    return rowsFromSpreadsheetXml({ sheet, sharedStrings });
  }
  return parseCsv(await file.text());
}
