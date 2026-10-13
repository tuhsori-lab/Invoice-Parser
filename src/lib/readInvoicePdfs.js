/**
 * The invoice number in each of a set of single-invoice PDFs.
 *
 * Each file is opened in turn, its text read page by page (up to ten pages)
 * and run through the same detection the Split tab uses - the everyday labels,
 * and any box saved for a client. When the text gives no number, the file's
 * name is tried. A file that is not a PDF, is damaged or locked, is kept with
 * the reason, never matched.
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
import { classifyError } from '../core/errors.js';
import { numberFromFileName } from '../core/reconcile/fileName.js';

/** Pages read from each file, at most. An invoice is rarely longer. */
const MOST_PAGES = 10;

/** Scanned files opened at once for text recognition. */
const SCAN_CHUNK = 6;

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
  for (let n = 1; n <= Math.min(doc.numPages, MOST_PAGES); n += 1) {
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
 * Read one file.
 *
 * @param {{ file: File, path: string }} input
 * @param {object} settings - from detectionSettings.
 * @returns {Promise<import('../core/reconcile/match.js').PdfItem & { file: File, scan: boolean }>}
 */
export async function readInvoicePdf({ file, path }, settings) {
  counter += 1;
  const item = {
    id: `pdf-${counter}`,
    file,
    fileName: file.name,
    path: path || file.name,
    invoice: null,
    source: null,
    others: [],
    problem: null,
    scan: false,
  };
  if (!isPdfFile(file)) return { ...item, problem: 'not-a-pdf' };

  let doc;
  try {
    doc = await openPdf(new Uint8Array(await file.arrayBuffer()));
  } catch (error) {
    return { ...item, problem: classifyError(error) };
  }
  try {
    const pages = await pagesOf(doc, item.id, file.name);
    const found = [
      ...new Set(
        analyzePages(pages, settings)
          .map((page) => page.detection?.value)
          .filter(Boolean)
      ),
    ];
    if (found.length) return { ...item, invoice: found[0], others: found.slice(1), source: 'text' };
    const fromName = numberFromFileName(file.name);
    return {
      ...item,
      invoice: fromName,
      source: fromName ? 'filename' : null,
      // Nothing to read on the page itself: text recognition could help.
      scan: pages.length > 0 && pages.every((page) => !page.hasText),
    };
  } catch (error) {
    return { ...item, problem: classifyError(error) };
  } finally {
    doc.destroy();
  }
}

/**
 * Read many files, one at a time.
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
    items.push(await readInvoicePdf(input, settings));
    await pause();
  }
  onProgress?.({ done: items.length, total: inputs.length, fileName: '' });
  return items;
}

/**
 * Read the first page of scanned files with text recognition.
 *
 * @param {Array<object>} items - files read before, with `scan` set.
 * @param {object} [options] - as for readInvoicePdfs.
 * @returns {Promise<Map<string, string>>} the number found, by file id.
 */
export async function readScannedPdfs(items, { onProgress, signal } = {}) {
  const settings = detectionSettings();
  const found = new Map();
  let done = 0;
  try {
    for (let start = 0; start < items.length; start += SCAN_CHUNK) {
      if (signal?.aborted) break;
      const chunk = items.slice(start, start + SCAN_CHUNK);
      const docs = new Map();
      const pages = [];
      for (const item of chunk) {
        try {
          const doc = await openPdf(new Uint8Array(await item.file.arrayBuffer()));
          docs.set(item.id, doc);
          pages.push({
            index: pages.length + 1,
            fileId: item.id,
            fileName: item.fileName,
            pageNumberInFile: 1,
            hasText: false,
            text: '',
          });
        } catch {
          // Opened once already; if it will not open now, it stays as it was.
        }
      }
      try {
        const readings = await readScannedPages(pages, docs, {
          signal,
          judge: (page, reading) => judgeReading(page, reading, settings),
          onProgress: (progress) =>
            onProgress?.({ done: done + progress.done, total: items.length, fileName: '' }),
        });
        for (const page of pages) {
          const reading = readings.get(page.index);
          if (!reading) continue;
          const [read] = analyzePages([{ ...page, ...reading, ocr: true }], settings);
          if (read.detection?.value) found.set(page.fileId, read.detection.value);
        }
      } finally {
        for (const doc of docs.values()) doc.destroy();
      }
      done += chunk.length;
      onProgress?.({ done, total: items.length, fileName: '' });
    }
  } finally {
    await stopOcr();
  }
  return found;
}
