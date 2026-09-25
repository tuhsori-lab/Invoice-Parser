/**
 * Small pictures of pages, drawn only when they are needed.
 *
 * A thousand-page batch cannot render a thousand thumbnails up front, so a page
 * is drawn the first time someone looks at it and kept after that.
 */

const cache = new Map();
const inFlight = new Map();

/** The key a page is remembered under. */
function keyFor(fileId, pageNumber, width) {
  return `${fileId}:${pageNumber}:${width}`;
}

/**
 * A picture of one page, as a data URL.
 *
 * @param {object} page - a page from the batch.
 * @param {object} doc - the pdf.js document that page came from.
 * @param {number} [width] - how wide to draw it, in pixels.
 * @returns {Promise<string>}
 */
export async function pageThumbnail(page, doc, width = 150) {
  const key = keyFor(page.fileId, page.pageNumberInFile, width);
  if (cache.has(key)) return cache.get(key);
  if (inFlight.has(key)) return inFlight.get(key);

  const work = (async () => {
    const pdfPage = await doc.getPage(page.pageNumberInFile);
    const unscaled = pdfPage.getViewport({ scale: 1 });
    const viewport = pdfPage.getViewport({ scale: width / unscaled.width });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await pdfPage.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    pdfPage.cleanup();
    const url = canvas.toDataURL('image/png');
    cache.set(key, url);
    inFlight.delete(key);
    return url;
  })();

  inFlight.set(key, work);
  return work;
}

/** Forget every picture, for when a new batch is loaded. */
export function clearThumbnails() {
  cache.clear();
  inFlight.clear();
}
