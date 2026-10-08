/**
 * Reading pages that are only a picture.
 *
 * A scanned invoice has no text in it at all - it is a photograph of a piece of
 * paper - so the words have to be worked out from the pixels. That is slow and
 * never perfect, which is why it is offered rather than done automatically, why
 * it can be stopped part way, and why a number read this way is only trusted
 * when something else backs it up.
 *
 * The recognition engine, its WebAssembly and the English language data are all
 * served by this app (copied into public/ by scripts/copy-assets.js). Turning
 * text recognition on fetches them from this app's own origin; no page, and no
 * picture of a page, goes anywhere.
 */

import { buildRecognisedText } from '../core/extractText.js';
import { valueInBoxText } from '../core/detect.js';
import { cleanUp, cropForBox } from '../core/image.js';
import { needsSecondLook, readingWidths, secondIsBetter } from '../core/scans.js';

const BASE = import.meta.env.BASE_URL;

/**
 * How a whole page is laid out for recognition. 6 - "one block of text" - is
 * the engine's own default and what this app has always used.
 */
export const DEFAULT_PAGE_MODE = 6;

/** Reading a box: one line of text. */
const LINE_MODE = 7;

/** The only characters an invoice number is made of, for reading a box. */
const NUMBER_CHARACTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-/_.';

/**
 * The ways a box is read: two sizes in black and white with coloured marks
 * washed out, and one in plain grey. Three readings that agree are far stronger
 * evidence than one; readings that do not are shown to a person rather than
 * chosen between.
 */
const BOX_READINGS = [
  { capitals: 30, threshold: true, dropColour: true },
  { capitals: 42, threshold: true, dropColour: true },
  { capitals: 36, threshold: false, dropColour: false },
];

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

/** Let a canvas go straight away: a page at reading size is several megabytes. */
function release(canvas) {
  canvas.width = 0;
  canvas.height = 0;
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
async function readAt(worker, page, doc, width, settings) {
  const { canvas, scale, pageHeight } = await drawPage(page, doc, width);
  try {
    const { data } = await worker.recognize(canvas, { rotateAuto: settings.rotateAuto });
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
    release(canvas);
  }
}

/**
 * Draw just the part of a page around a box, large and clean: padded a fifth
 * each way, sized so capitals are `capitals` pixels tall, then turned to grey or
 * to pure black and white.
 */
async function drawBox(page, doc, zone, { capitals, threshold, dropColour }) {
  const pdfPage = await doc.getPage(page.pageNumberInFile);
  const unscaled = pdfPage.getViewport({ scale: 1 });
  const crop = cropForBox(zone, { width: unscaled.width, height: unscaled.height }, capitals);
  const viewport = pdfPage.getViewport({ scale: crop.scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(crop.width * crop.scale));
  canvas.height = Math.max(1, Math.ceil(crop.height * crop.scale));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  await pdfPage.render({
    canvasContext: context,
    viewport,
    transform: [1, 0, 0, 1, -crop.x * crop.scale, -crop.y * crop.scale],
  }).promise;
  pdfPage.cleanup();
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  cleanUp(image.data, { threshold, dropColour });
  context.putImageData(image, 0, 0);
  return canvas;
}

/**
 * Read the box a client's number is printed in, on its own, several ways.
 *
 * @returns {Promise<Array<{ value: string|null, confidence: number|null }>>}
 */
async function readBox(worker, page, doc, box, settings) {
  const readings = [];
  await worker.setParameters({
    tessedit_pageseg_mode: String(LINE_MODE),
    tessedit_char_whitelist: NUMBER_CHARACTERS,
  });
  try {
    for (const variant of BOX_READINGS) {
      const canvas = await drawBox(page, doc, box.zone, variant);
      try {
        const { data } = await worker.recognize(canvas);
        const value = valueInBoxText(data.text, box.shape);
        // How sure it was of the words the value was made from.
        const words = (data.words ?? []).filter(
          (word) =>
            value &&
            value.includes(
              String(word.text)
                .toUpperCase()
                .replace(/[-_/]+$/, '')
            )
        );
        const confidence = words.length
          ? Math.min(...words.map((word) => word.confidence))
          : value
            ? data.confidence
            : null;
        // Whether anything at all is printed in the box, number or not.
        readings.push({ value, confidence, ink: Boolean(String(data.text ?? '').trim()) });
      } finally {
        release(canvas);
      }
    }
  } finally {
    await worker.setParameters({
      tessedit_pageseg_mode: String(settings.pageMode),
      tessedit_char_whitelist: '',
    });
  }
  return readings;
}

/**
 * Read the pages that are pictures of paper.
 *
 * Each page is drawn at the size it was scanned at, within limits (see
 * readingWidths), which is where recognition reads small print best. When the
 * page turns out to belong to a client with a saved box, that box is read again
 * on its own, several ways, so the number has readings to be checked against.
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
 * @param {(page: object, reading: object) => { zone: object, name: string, shape: string }|null} [options.boxFor]
 *   the saved box for the client this reading belongs to, if there is one.
 * @param {number} [options.pageMode] - how a whole page is laid out for recognition.
 * @param {boolean} [options.rotateAuto] - straighten a crooked page before reading it.
 * @returns {Promise<Map<number, { text: string, hasText: boolean, layout: Array<object>|null,
 *   boxReadings?: object }>>} what was read, by page number.
 */
export async function readScannedPages(pages, docsById, options = {}) {
  const { onProgress, signal, judge, boxFor } = options;
  const settings = {
    pageMode: options.pageMode ?? DEFAULT_PAGE_MODE,
    rotateAuto: options.rotateAuto ?? false,
  };
  const found = new Map();
  if (pages.length === 0) return found;

  const worker = await getWorker();
  await worker.setParameters({ tessedit_pageseg_mode: String(settings.pageMode) });

  for (const [position, page] of pages.entries()) {
    if (signal?.aborted) break;
    onProgress?.({ done: position, total: pages.length, pageIndex: page.index });

    const doc = docsById.get(page.fileId);
    if (!doc) continue;

    const widths = readingWidths(page.pixelsAcross);
    let reading = await readAt(worker, page, doc, widths.first, settings);

    // A client with a saved box: read the box on its own as well.
    const box = boxFor?.(page, reading);
    if (box && !signal?.aborted) {
      reading.boxReadings = {
        name: box.name,
        readings: await readBox(worker, page, doc, box, settings),
      };
    }

    if (judge && !signal?.aborted) {
      const verdict = judge(page, reading);
      if (needsSecondLook(verdict)) {
        const second = await readAt(worker, page, doc, widths.second, settings);
        second.boxReadings = reading.boxReadings;
        if (secondIsBetter(verdict, judge(page, second))) reading = second;
      }
    }

    found.set(page.index, reading);
    onProgress?.({ done: position + 1, total: pages.length, pageIndex: page.index });
  }

  return found;
}
