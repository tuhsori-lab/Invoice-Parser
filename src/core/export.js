/**
 * Building the files that come out: one PDF per invoice, a ZIP of all of them,
 * and a CSV page map.
 *
 * Everything here happens in memory, in the browser. Nothing is uploaded.
 */

import { PDFDocument } from 'pdf-lib';
import JSZip from 'jszip';
import { pageRangeForCsv } from './naming.js';

/** Columns of the CSV page map, in order. */
export const CSV_COLUMNS = [
  'Invoice',
  'Extra',
  'Found after',
  'Pages',
  'Page count',
  'File name',
  'Source file(s)',
];

/**
 * Byte order mark. Without it Excel reads the file as the local code page and
 * turns any accented character into mojibake.
 */
const UTF8_BOM = '\ufeff';

/**
 * Copy one invoice's pages into a new PDF.
 *
 * An invoice can straddle two source files - the batch was split by whoever
 * scanned it, not by the invoices - so pages are copied source by source and
 * then put back in the order they appear in the group.
 *
 * @param {object} group - a group from group.js.
 * @param {Map<string, import('pdf-lib').PDFDocument>} sources - loaded source
 *   documents, keyed by the `fileId` on each page.
 * @returns {Promise<Uint8Array>} the finished PDF.
 */
export async function buildInvoicePdf(group, sources) {
  const out = await PDFDocument.create();

  // Copy in runs from the same file, because copyPages takes one source at a time.
  let run = [];
  const flush = async () => {
    if (run.length === 0) return;
    const fileId = run[0].fileId;
    const source = sources.get(fileId);
    if (!source) {
      throw new Error(`The file these pages came from is no longer open (${fileId}).`);
    }
    const copied = await out.copyPages(
      source,
      run.map((page) => page.filePageIndex)
    );
    copied.forEach((page) => out.addPage(page));
    run = [];
  };

  for (const page of group.pages) {
    if (run.length > 0 && run[0].fileId !== page.fileId) await flush();
    run.push(page);
  }
  await flush();

  return out.save();
}

/**
 * Put every invoice into one ZIP.
 *
 * The STORE method is used on purpose: a PDF is already compressed, so deflating
 * it again costs seconds on a big batch and saves almost nothing.
 *
 * @param {Array<{ name: string, data: Uint8Array }>} files
 * @param {object} [options]
 * @param {'uint8array'|'blob'} [options.type]
 * @param {(percent: number) => void} [options.onProgress]
 * @returns {Promise<Uint8Array|Blob>}
 */
export async function buildZip(files, options = {}) {
  const { type = 'blob', onProgress } = options;
  const zip = new JSZip();
  for (const file of files) {
    zip.file(file.name, file.data, { compression: 'STORE', date: new Date() });
  }
  return zip.generateAsync({ type, compression: 'STORE' }, (metadata) => {
    onProgress?.(metadata.percent);
  });
}

/**
 * Wrap a value in quotes if it contains anything that would break a CSV row.
 *
 * Semicolons are quoted too: Excel uses a semicolon as the column separator in
 * several countries, and an unquoted one there splits a cell in half.
 */
function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  if (/[",;\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/**
 * The page map: one row per invoice, saying where it came from.
 *
 * Page ranges are written as "1 to 3, 7". Excel reads "1-3" as a date and shows
 * "3-Jan", which makes the page map useless for the person checking it.
 *
 * @param {Array<object>} groups - groups that already have `fileName` set.
 * @returns {string} the CSV text, starting with a UTF-8 byte order mark.
 */
export function buildCsv(groups = []) {
  const rows = [CSV_COLUMNS];

  for (const group of groups) {
    const pageNumbers = group.pages.map((page) => page.index);
    const sourceFiles = [...new Set(group.pages.map((page) => page.fileName))];
    rows.push([
      group.invoice ?? '',
      group.extra?.value ?? '',
      group.provenance?.label ?? '',
      pageRangeForCsv(pageNumbers),
      pageNumbers.length,
      group.fileName ?? '',
      sourceFiles.join('; '),
    ]);
  }

  const body = rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
  return `${UTF8_BOM}${body}\r\n`;
}

/**
 * Build every invoice PDF in the batch, reporting progress as it goes.
 *
 * @param {Array<object>} groups - groups that already have `fileName` set.
 * @param {Map<string, import('pdf-lib').PDFDocument>} sources
 * @param {object} [options]
 * @param {(done: number, total: number) => void} [options.onProgress]
 * @param {{ aborted: boolean }} [options.signal]
 * @returns {Promise<Array<{ name: string, data: Uint8Array }>>}
 */
export async function buildAllInvoicePdfs(groups, sources, options = {}) {
  const { onProgress, signal } = options;
  const files = [];
  for (const [position, group] of groups.entries()) {
    if (signal?.aborted) break;
    files.push({ name: group.fileName, data: await buildInvoicePdf(group, sources) });
    onProgress?.(position + 1, groups.length);
  }
  return files;
}
