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

/**
 * How wide to draw a page before reading it.
 *
 * About 180 dots per inch for a letter-size page. Measured against the sample
 * scan: less than this loses letters, and more makes them break apart, so it is
 * a setting arrived at by trying rather than by theory.
 */
const RENDER_WIDTH = 1500;

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

/** Draw one page big enough to read. */
async function drawPage(page, doc) {
  const pdfPage = await doc.getPage(page.pageNumberInFile);
  const unscaled = pdfPage.getViewport({ scale: 1 });
  const viewport = pdfPage.getViewport({ scale: RENDER_WIDTH / unscaled.width });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await pdfPage.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  pdfPage.cleanup();
  return canvas;
}

/**
 * Read the pages that have no text of their own.
 *
 * @param {Array<object>} pages - the pages to read, usually the ones with no text.
 * @param {Map<string, object>} docsById - the pdf.js documents they came from.
 * @param {object} [options]
 * @param {(progress: { done: number, total: number, pageIndex: number }) => void} [options.onProgress]
 * @param {{ aborted: boolean }} [options.signal] - set `aborted` to stop after the current page.
 * @returns {Promise<Map<number, string>>} the text found, by page number.
 */
export async function readScannedPages(pages, docsById, options = {}) {
  const { onProgress, signal } = options;
  const found = new Map();
  if (pages.length === 0) return found;

  const worker = await getWorker();

  for (const [position, page] of pages.entries()) {
    if (signal?.aborted) break;
    onProgress?.({ done: position, total: pages.length, pageIndex: page.index });

    const doc = docsById.get(page.fileId);
    if (!doc) continue;

    const canvas = await drawPage(page, doc);
    const { data } = await worker.recognize(canvas);
    // Let the canvas go straight away: a page at this size is several megabytes.
    canvas.width = 0;
    canvas.height = 0;

    found.set(page.index, (data.text ?? '').trim());
    onProgress?.({ done: position + 1, total: pages.length, pageIndex: page.index });
  }

  return found;
}
