/**
 * The invoices in a set of PDFs, each file split the way the Split tab splits it.
 *
 * Each file is opened in turn, every page read and run through the same
 * detection and grouping the Split tab uses - the everyday labels, and any box
 * saved for a client - giving one item per invoice. A file whose text gives no
 * number at all is tried by its name, as one invoice. A file that is not a PDF,
 * is damaged or locked, is kept with the reason, never matched.
 *
 * Files are read one at a time and the browser is given a moment between them,
 * so two hundred PDFs never freeze the tab, and the count it reports is exact.
 * Scanned files - pictures with no text - can then be read with text
 * recognition, on request, since that is slow.
 */

import { openPdf } from './pdfjs.js';
import { isPdfFile } from './droppedFiles.js';
import { readScannedPages, stopOcr } from './ocr.js';
import { loadBoxes } from './boxStore.js';
import { buildPageText } from '../core/extractText.js';
import { analyzePages, judgeReading } from '../core/analyze.js';
import { groupPages } from '../core/group.js';
import { pageRangeForCsv } from '../core/naming.js';
import { classifyError } from '../core/errors.js';
import { numberFromFileName } from '../core/reconcile/fileName.js';

let counter = 0;

/** How the number is found: as on the Split tab, with every saved box. */
export function detectionSettings() {
  return {
    profiles: loadBoxes(),
    useCommonLabels: true,
    useBareInvoice: true,
    customPattern: '',
    extraLabel: '',
  };
}

const pause = () => new Promise((resolve) => setTimeout(resolve, 0));

/** The pages of one open PDF, in the form detection reads. */
async function pagesOf(doc, id, fileName) {
  const pages = [];
  for (let n = 1; n <= doc.numPages; n += 1) {
    const page = await doc.getPage(n);
    const { text, hasText, layout } = buildPageText((await page.getTextContent()).items);
    const { width, height } = page.getViewport({ scale: 1 });
    page.cleanup();
    pages.push({
      index: n,
      fileId: id,
      fileName,
      filePageIndex: n - 1,
      pageNumberInFile: n,
      text,
      hasText,
      layout,
      pageWidth: width,
      pageHeight: height,
      ocr: false,
    });
  }
  return pages;
}

/**
 * One item per invoice the pages split into. A file of more than one invoice
 * says which pages each came from, so two invoices of one file can be told apart.
 */
function splitInto(item, pages, settings, source) {
  const groups = groupPages(analyzePages(pages, settings));
  return groups.map((group, position) => {
    const pageNumbers = group.pages.map((page) => page.pageNumberInFile);
    return {
      ...item,
      id: `${item.id}-${position + 1}`,
      path: groups.length > 1 ? `${item.path} (p. ${pageRangeForCsv(pageNumbers)})` : item.path,
      invoice: group.invoice,
      source: group.invoice ? source : null,
      pages: pageNumbers,
      flags: group.flags,
    };
  });
}

/**
 * Read one file and split it into invoices.
 *
 * @param {{ file: File, path: string }} input
 * @param {object} settings - from detectionSettings.
 * @returns {Promise<Array<import('../core/reconcile/match.js').PdfItem & { file: File, fileId: string, scan: boolean }>>}
 */
export async function readInvoicePdf({ file, path }, settings) {
  counter += 1;
  const item = {
    id: `pdf-${counter}`,
    fileId: `pdf-${counter}`,
    file,
    fileName: file.name,
    path: path || file.name,
    sourcePath: path || file.name,
    invoice: null,
    source: null,
    pages: [],
    flags: [],
    problem: null,
    scan: false,
  };
  if (!isPdfFile(file)) return [{ ...item, problem: 'not-a-pdf' }];

  let doc;
  try {
    doc = await openPdf(new Uint8Array(await file.arrayBuffer()));
  } catch (error) {
    return [{ ...item, problem: classifyError(error) }];
  }
  try {
    const pages = await pagesOf(doc, item.id, file.name);
    const split = splitInto(item, pages, settings, 'text');
    if (split.some((entry) => entry.invoice)) return split;
    const fromName = numberFromFileName(file.name);
    return [
      {
        ...item,
        invoice: fromName,
        source: fromName ? 'filename' : null,
        pages: pages.map((page) => page.pageNumberInFile),
        // Nothing to read on the page itself: text recognition could help.
        scan: pages.length > 0 && pages.every((page) => !page.hasText),
      },
    ];
  } catch (error) {
    return [{ ...item, problem: classifyError(error) }];
  } finally {
    doc.destroy();
  }
}

/**
 * Read many files, one at a time, into one list of invoices.
 *
 * @param {Array<{ file: File, path: string }>} inputs
 * @param {object} [options]
 * @param {(progress: { done: number, total: number, fileName: string }) => void} [options.onProgress]
 * @param {{ aborted: boolean }} [options.signal] - set `aborted` to stop after the current file.
 * @returns {Promise<Array<object>>}
 */
export async function readInvoicePdfs(inputs, { onProgress, signal } = {}) {
  const settings = detectionSettings();
  const items = [];
  for (const [position, input] of inputs.entries()) {
    if (signal?.aborted) break;
    onProgress?.({ done: position, total: inputs.length, fileName: input.file.name });
    items.push(...(await readInvoicePdf(input, settings)));
    await pause();
  }
  onProgress?.({ done: inputs.length, total: inputs.length, fileName: '' });
  return items;
}

/**
 * Read scanned files with text recognition, every page, and split them.
 *
 * @param {Array<object>} items - files read before, with `scan` set.
 * @param {object} [options] - as for readInvoicePdfs.
 * @returns {Promise<Map<string, Array<object>>>} the invoices found, by file id.
 */
export async function readScannedPdfs(items, { onProgress, signal } = {}) {
  const settings = detectionSettings();
  const found = new Map();
  try {
    for (const [done, item] of items.entries()) {
      if (signal?.aborted) break;
      onProgress?.({ done, total: items.length, fileName: item.fileName });
      let doc;
      try {
        doc = await openPdf(new Uint8Array(await item.file.arrayBuffer()));
      } catch {
        // Opened once already; if it will not open now, it stays as it was.
        continue;
      }
      try {
        const pages = await pagesOf(doc, item.fileId, item.fileName);
        const readings = await readScannedPages(pages, new Map([[item.fileId, doc]]), {
          signal,
          judge: (page, reading) => judgeReading(page, reading, settings),
        });
        const read = pages.map((page) =>
          readings.has(page.index) ? { ...page, ...readings.get(page.index), ocr: true } : page
        );
        const split = splitInto({ ...item, scan: false }, read, settings, 'scan');
        if (split.some((entry) => entry.invoice)) found.set(item.fileId, split);
      } finally {
        doc.destroy();
      }
    }
    onProgress?.({ done: items.length, total: items.length, fileName: '' });
  } finally {
    await stopOcr();
  }
  return found;
}
