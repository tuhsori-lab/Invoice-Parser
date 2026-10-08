/**
 * Reading pages that are only a picture.
 *
 * A scanned invoice has no text in it at all - it is a photograph of a piece of
 * paper - so the words have to be worked out from the pixels. That is slow and
 * never perfect, which is why it is offered rather than done automatically, why
 * it can be stopped part way, and why a number read this way is only trusted
 * when something else backs it up.
 *
 * To be quicker about it, several pages are read at once, one on each of a few
 * copies of the recognition engine; the next page is drawn while the others are
 * being read; and for a client with a saved box, only the top of the page, the
 * box and the foot of the page are read (see quickRead.js).
 *
 * The recognition engine, its WebAssembly and the English language data are all
 * served by this app (copied into public/ by scripts/copy-assets.js). Turning
 * text recognition on fetches them from this app's own origin; no page, and no
 * picture of a page, goes anywhere.
 */

import { buildRecognisedText } from '../core/extractText.js';
import { valueInBoxText } from '../core/detect.js';
import { cleanUp, cropForBox } from '../core/image.js';
import { placeStripLines, stripsFor, workerCount } from '../core/quickRead.js';
import { needsSecondLook, readingWidths, secondIsBetter } from '../core/scans.js';

const BASE = import.meta.env.BASE_URL;

/**
 * How a whole page is laid out for recognition: 12, text scattered about the
 * page. Of the modes tried on the sample scans (3, 6, 11 and 12) it read the
 * most invoice numbers right, and none of them wrongly - see the README.
 */
export const DEFAULT_PAGE_MODE = 12;

/** Reading a box: one line of text. */
const LINE_MODE = 7;

/** The only characters an invoice number is made of, for reading a box. */
const NUMBER_CHARACTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-/_.';

/**
 * What to ask the engine for: the words and where they sat. Not the two other
 * forms of the same thing it would otherwise build for every page.
 */
const OUTPUT = { text: true, blocks: true, hocr: false, tsv: false };

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

/**
 * A box reading recognition is less sure of than this is taken as not read:
 * at such a score it is guessing at specks, and a guess shown beside the real
 * number only gets in its way. That it found ink there still counts.
 */
const LEAST_BOX_CONFIDENCE = 50;

let enginePromise = null;

/**
 * Start the recognition engine - a few copies of it, one a page - or hand back
 * the one already running. The library itself is only loaded at this point, so
 * an ordinary batch never downloads a line of it.
 */
function getEngine() {
  if (!enginePromise) {
    enginePromise = (async () => {
      const { createScheduler, createWorker } = await import('tesseract.js');
      const scheduler = createScheduler();
      const count = workerCount(globalThis.navigator?.hardwareConcurrency);
      const workers = await Promise.all(
        Array.from({ length: count }, () =>
          createWorker('eng', 1, {
            workerPath: `${BASE}tesseract/worker.min.js`,
            corePath: `${BASE}tesseract/`,
            langPath: `${BASE}tesseract/lang/`,
            gzip: true,
          })
        )
      );
      for (const worker of workers) scheduler.addWorker(worker);
      return { scheduler, workers, count };
    })().catch((error) => {
      enginePromise = null;
      throw error;
    });
  }
  return enginePromise;
}

/**
 * Start the engine ahead of time - as soon as scanned pages turn up - so it is
 * ready by the time somebody asks for them to be read. Fetched from this app.
 *
 * @returns {Promise<void>} settles when the engine is ready, or could not start.
 */
export function preloadOcr() {
  return getEngine().then(
    () => undefined,
    () => {
      // Reported properly when reading is actually asked for.
    }
  );
}

/** Shut the engine down and free what it was holding. */
export async function stopOcr() {
  if (!enginePromise) return;
  const pending = enginePromise;
  enginePromise = null;
  try {
    const { scheduler } = await pending;
    await scheduler.terminate();
  } catch {
    // An engine that never started needs no stopping.
  }
}

/** Let a canvas go straight away: a page at reading size is several megabytes. */
function release(canvas) {
  canvas.width = 0;
  canvas.height = 0;
}

/** Hand one picture to whichever copy of the engine is free. */
async function recognise(engine, image, options = {}) {
  const { data } = await engine.scheduler.addJob('recognize', image, options, OUTPUT);
  return data;
}

/** The lines and words of a reading, in the form buildRecognisedText takes. */
function linesOf(data) {
  return (data.lines ?? []).map((line) => ({
    bbox: line.bbox,
    words: (line.words ?? []).map((word) => ({
      text: word.text,
      bbox: word.bbox,
      confidence: word.confidence,
    })),
  }));
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
  return { canvas, scale, pageWidth: unscaled.width, pageHeight: unscaled.height };
}

/** Copy part of a drawn page onto a canvas of its own, at `factor` times the size. */
function cut(source, { left, top, width, height }, factor = 1) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * factor));
  canvas.height = Math.max(1, Math.round(height * factor));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, left, top, width, height, 0, 0, canvas.width, canvas.height);
  return { canvas, context };
}

/** What a reading of a page gives, in the same form as a PDF's own text. */
function toReading(lines, drawn, fallbackText = '') {
  const { text, hasText, layout } = buildRecognisedText(lines, {
    scale: drawn.scale,
    pageHeight: drawn.pageHeight,
  });
  // Should a reading ever come back without word boxes, keep its words at least.
  return text || !fallbackText.trim()
    ? { text, hasText, layout }
    : { text: fallbackText.trim(), hasText: true, layout: null };
}

/** Read a whole drawn page. */
async function readWhole(engine, drawn, settings) {
  const data = await recognise(engine, drawn.canvas, { rotateAuto: settings.rotateAuto });
  return toReading(linesOf(data), drawn, data.text ?? '');
}

/** Read some bands of a drawn page, each on its own. */
async function readStrips(engine, drawn, strips) {
  return Promise.all(
    strips.map(async (strip) => {
      const { canvas } = cut(drawn.canvas, strip);
      try {
        return { strip, lines: linesOf(await recognise(engine, canvas)) };
      } finally {
        release(canvas);
      }
    })
  );
}

/**
 * Read the box a client's number is printed in, on its own, several ways: cut
 * from the drawn page with a fifth to spare each way, enlarged so capitals are
 * `capitals` pixels tall, turned to grey or to pure black and white, and read
 * as one line of the characters invoice numbers are made of.
 *
 * @returns {Promise<Array<{ value: string|null, confidence: number|null, ink: boolean }>>}
 */
async function readBox(engine, drawn, box) {
  return Promise.all(
    BOX_READINGS.map(async ({ capitals, threshold, dropColour }) => {
      const crop = cropForBox(
        box.zone,
        { width: drawn.pageWidth, height: drawn.pageHeight },
        capitals
      );
      const { canvas, context } = cut(
        drawn.canvas,
        {
          left: crop.x * drawn.scale,
          top: crop.y * drawn.scale,
          width: crop.width * drawn.scale,
          height: crop.height * drawn.scale,
        },
        crop.scale / drawn.scale
      );
      try {
        const image = context.getImageData(0, 0, canvas.width, canvas.height);
        cleanUp(image.data, { threshold, dropColour });
        context.putImageData(image, 0, 0);
        const data = await recognise(engine, canvas, {
          tessedit_pageseg_mode: String(LINE_MODE),
          tessedit_char_whitelist: NUMBER_CHARACTERS,
        });
        const read = valueInBoxText(data.text, box.shape);
        // How sure it was of the words the value was made from.
        const words = (data.words ?? []).filter(
          (word) =>
            read &&
            read.includes(
              String(word.text)
                .toUpperCase()
                .replace(/[-_/]+$/, '')
            )
        );
        const score = words.length
          ? Math.min(...words.map((word) => word.confidence))
          : read
            ? data.confidence
            : null;
        const guessing = typeof score === 'number' && score < LEAST_BOX_CONFIDENCE;
        const value = guessing ? null : read;
        const confidence = guessing ? null : score;
        // Whether anything is printed in the box, number or not: two letters or
        // digits at least, not a stray mark.
        const ink = (String(data.text ?? '').match(/[A-Za-z0-9]/g) ?? []).length >= 2;
        return { value, confidence, ink };
      } finally {
        release(canvas);
      }
    })
  );
}

/**
 * Read one page: quickly, in bands, when the top of it names a client with a
 * saved box; otherwise whole. Then, if what was read is unsure, whole again at
 * another size, keeping the better of the two.
 */
async function readOne(engine, page, doc, options, settings) {
  const { judge, boxFor, quick } = options;
  const widths = readingWidths(page.pixelsAcross);
  const drawn = await drawPage(page, doc, widths.first);
  let reading;
  let firstVerdict = null;
  try {
    let box = null;
    if (quick && boxFor) {
      // Whose invoice it is, from the top of the page.
      const [top, bottom] = stripsFor(null, drawn.canvas);
      const heading = await readStrips(engine, drawn, [top]);
      box = boxFor(page, toReading(placeStripLines(heading), drawn));
      if (box) {
        const rest = stripsFor(box.zone, drawn.canvas).filter((strip) => strip.name !== 'top');
        const [others, readings] = await Promise.all([
          readStrips(engine, drawn, rest.length ? rest : [bottom]),
          readBox(engine, drawn, box),
        ]);
        const quickReading = toReading(placeStripLines([...heading, ...others]), drawn);
        // Only parts of the page were read: anything else on it was not.
        quickReading.partial = true;
        quickReading.boxReadings = { name: box.name, readings };
        // Kept only when it is sure of one number. A page read in parts whose
        // box is empty is a later page of an invoice, with no number to find.
        const verdict = judge ? judge(page, quickReading) : null;
        const emptyBox = !readings.some((entry) => entry.ink) && !verdict?.value;
        if (!verdict || emptyBox || (!verdict.conflict && !needsSecondLook(verdict))) {
          return quickReading;
        }
        // Unsure, or two readings disagree: the whole page gets a second look.
        reading = quickReading;
        firstVerdict = verdict;
      }
    }
    if (!reading) {
      reading = await readWhole(engine, drawn, settings);
      box = boxFor?.(page, reading) ?? null;
      if (box)
        reading.boxReadings = { name: box.name, readings: await readBox(engine, drawn, box) };
    }
  } finally {
    release(drawn.canvas);
  }

  if (!judge) return reading;
  const verdict = firstVerdict ?? judge(page, reading);
  const doubtful = needsSecondLook(verdict) || (reading.partial && verdict.conflict);
  if (!doubtful || options.signal?.aborted) return reading;

  const again = await drawPage(page, doc, widths.second);
  try {
    const second = await readWhole(engine, again, settings);
    second.boxReadings = reading.boxReadings;
    return secondIsBetter(verdict, judge(page, second)) ? second : reading;
  } finally {
    release(again.canvas);
  }
}

/**
 * Read the pages that are pictures of paper.
 *
 * Each page is drawn at the size it was scanned at, within limits (see
 * readingWidths), which is where recognition reads small print best. Several
 * pages are read at once. When a page turns out to belong to a client with a
 * saved box, that box is read again on its own, several ways, so the number has
 * readings to be checked against.
 *
 * @param {Array<object>} pages - the pages to read: scans, with no text of their
 *   own or none that carries the invoice number. A page's `pixelsAcross`, when
 *   known, says how finely it was scanned.
 * @param {Map<string, object>} docsById - the pdf.js documents they came from.
 * @param {object} [options]
 * @param {(progress: { done: number, total: number, pageIndex: number }) => void} [options.onProgress]
 * @param {{ aborted: boolean }} [options.signal] - set `aborted` to stop; pages
 *   already being read are finished, no more are started.
 * @param {(page: object, reading: object) => { value: string|null, confidence: number|null }} [options.judge]
 *   what a reading of a page gives: its invoice number and how sure recognition
 *   was of it. When there is none, or it was read unsurely, the page is read a
 *   second time at another size, and the better of the two readings is kept.
 * @param {(page: object, reading: object) => { zone: object, name: string, shape: string }|null} [options.boxFor]
 *   the saved box for the client this reading belongs to, if there is one.
 * @param {boolean} [options.quick] - read only the top, the box and the foot of
 *   a page whose top names a client with a saved box.
 * @param {number} [options.pageMode] - how a whole page is laid out for recognition.
 * @param {boolean} [options.rotateAuto] - straighten a crooked page before reading it.
 * @returns {Promise<Map<number, { text: string, hasText: boolean, layout: Array<object>|null,
 *   boxReadings?: object, partial?: boolean }>>} what was read, by page number.
 */
export async function readScannedPages(pages, docsById, options = {}) {
  const { onProgress, signal } = options;
  const settings = {
    pageMode: options.pageMode ?? DEFAULT_PAGE_MODE,
    rotateAuto: options.rotateAuto ?? true,
  };
  const found = new Map();
  if (pages.length === 0) return found;

  const engine = await getEngine();
  await Promise.all(
    engine.workers.map((worker) =>
      worker.setParameters({ tessedit_pageseg_mode: String(settings.pageMode) })
    )
  );

  // One more page in hand than there are engines, so the next page is being
  // drawn while the others are being read.
  let next = 0;
  let done = 0;
  const lane = async () => {
    while (next < pages.length && !signal?.aborted) {
      const page = pages[next];
      next += 1;
      onProgress?.({ done, total: pages.length, pageIndex: page.index });
      const doc = docsById.get(page.fileId);
      if (doc) found.set(page.index, await readOne(engine, page, doc, options, settings));
      done += 1;
      onProgress?.({ done, total: pages.length, pageIndex: page.index });
    }
  };
  await Promise.all(Array.from({ length: engine.count + 1 }, lane));
  return found;
}
