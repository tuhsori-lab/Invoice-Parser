/**
 * Reading pages that are only a picture.
 *
 * A scanned invoice has no text in it at all - it is a photograph of a piece of
 * paper - so the words have to be worked out from the pixels. That is slow and
 * never perfect, which is why it is offered rather than done automatically, why
 * it can be stopped part way, and why anything read this way is flagged.
 *
 * The recognition engine, its WebAssembly and the English language data are all
 * served by this app (copied into public/ by scripts/copy-assets.js). Turning
 * text recognition on fetches them from this app's own origin; no page, and no
 * picture of a page, goes anywhere.
 */

import { buildRecognisedText } from '../core/extractText.js';
import { needsSecondLook, readingWidths, secondIsBetter } from '../core/scans.js';

const BASE = import.meta.env.BASE_URL;

let workerPromise = null;

/**
 * Start the recognition engine, or hand back the one already running.
 * The library itself is only loaded at this point, so an ordinary batch never
 * downloads a line of it.
 */
async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import('tesseract.js');
      return createWorker('eng', 1, {
        workerPath: `${BASE}tesseract/worker.min.js`,
        corePath: `${BASE}tesseract/`,
        langPath: `${BASE}tesseract/lang/`,
        gzip: true,
      });
    })().catch((error) => {
      workerPromise = null;
      throw error;
    });
  }
  return workerPromise;
}

/** Shut the engine down and free what it was holding. */
export async function stopOcr() {
  if (!workerPromise) return;
  const pending = workerPromise;
  workerPromise = null;
  try {
    const worker = await pending;
    await worker.terminate();
  } catch {
    // An engine that never started needs no stopping.
  }
}

/** Draw one page at a given width, big enough to read. */
async function drawPage(page, doc, width) {
  const pdfPage = await doc.getPage(page.pageNumberInFile);
  const unscaled = pdfPage.getViewport({ scale: 1 });
  const scale = width / unscaled.width;
  const viewport = pdfPage.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await pdfPage.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  pdfPage.cleanup();
  return { canvas, scale, pageHeight: unscaled.height };
}

/**
 * Read one page at one width: its text, and where every word of it sat.
 * Returned in the same form as a PDF's own text, so a box drawn on a scan is
 * read exactly as one drawn on any other page.
 */
async function readAt(worker, page, doc, width) {
  const { canvas, scale, pageHeight } = await drawPage(page, doc, width);
  try {
    const { data } = await worker.recognize(canvas);
    const lines = (data.lines ?? []).map((line) => ({
      bbox: line.bbox,
      words: (line.words ?? []).map((word) => ({
        text: word.text,
        bbox: word.bbox,
        confidence: word.confidence,
      })),
    }));
    const { text, hasText, layout } = buildRecognisedText(lines, { scale, pageHeight });
    // Should a reading ever come back without word boxes, keep its words at least.
    return text || !data.text
      ? { text, hasText, layout }
      : { text: data.text.trim(), hasText: Boolean(data.text.trim()), layout: null };
  } finally {
    // Let the canvas go straight away: a page at this size is several megabytes.
    canvas.width = 0;
    canvas.height = 0;
  }
}

/**
 * Read the pages that are pictures of paper.
 *
 * Each page is drawn at the size it was scanned at, within limits (see
 * readingWidths), which is where recognition reads small print best.
 *
 * @param {Array<object>} pages - the pages to read: scans, with no text of their
 *   own or none that carries the invoice number. A page's `pixelsAcross`, when
 *   known, says how finely it was scanned.
 * @param {Map<string, object>} docsById - the pdf.js documents they came from.
 * @param {object} [options]
 * @param {(progress: { done: number, total: number, pageIndex: number }) => void} [options.onProgress]
 * @param {{ aborted: boolean }} [options.signal] - set `aborted` to stop after the current page.
 * @param {(page: object, reading: object) => { value: string|null, confidence: number|null }} [options.judge]
 *   what a reading of a page gives: its invoice number and how sure recognition
 *   was of it. When there is none, or it was read unsurely, the page is read a
 *   second time at another size, and the better of the two readings is kept.
 * @returns {Promise<Map<number, { text: string, hasText: boolean, layout: Array<object>|null }>>}
 *   what was read, by page number.
 */
export async function readScannedPages(pages, docsById, options = {}) {
  const { onProgress, signal, judge } = options;
  const found = new Map();
  if (pages.length === 0) return found;

  const worker = await getWorker();

  for (const [position, page] of pages.entries()) {
    if (signal?.aborted) break;
    onProgress?.({ done: position, total: pages.length, pageIndex: page.index });

    const doc = docsById.get(page.fileId);
    if (!doc) continue;

    const widths = readingWidths(page.pixelsAcross);
    let reading = await readAt(worker, page, doc, widths.first);
    if (judge && !signal?.aborted) {
      const verdict = judge(page, reading);
      if (needsSecondLook(verdict)) {
        const second = await readAt(worker, page, doc, widths.second);
        if (secondIsBetter(verdict, judge(page, second))) reading = second;
      }
    }

    found.set(page.index, reading);
    onProgress?.({ done: position + 1, total: pages.length, pageIndex: page.index });
  }

  return found;
}
