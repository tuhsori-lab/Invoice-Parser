/**
 * Finding out which pages are pictures of paper.
 *
 * Only asked about pages that had no invoice number in their text, so an
 * ordinary batch of typed invoices hardly pays for it. The sums themselves are
 * in core/scans.js; this is the part that asks pdf.js what a page draws.
 */

import { WHOLE_PAGE_SPREAD, describePicture, isPicture, textSpread } from '../core/scans.js';
import { pdfjs } from './pdfjs.js';

/** Where a page came from, which stays true however the batch is regrouped. */
export function pictureKey(page) {
  return `${page.fileId}:${page.pageNumberInFile}`;
}

/**
 * How much of each page is covered by images, and how finely it was scanned.
 *
 * @param {Array<object>} pages - pages from loadBatch.
 * @param {Map<string, object>} docsById - the pdf.js documents they came from.
 * @param {{ aborted: boolean }} [signal] - set `aborted` to stop after the current page.
 * @returns {Promise<Map<string, { share: number, pixelsAcross: number }>>} keyed by pictureKey.
 */
export async function measurePictures(pages, docsById, signal) {
  const found = new Map();
  for (const page of pages) {
    if (signal?.aborted) break;
    const doc = docsById.get(page.fileId);
    if (!doc) continue;
    let picture = { share: 0, pixelsAcross: 0 };
    try {
      const pdfPage = await doc.getPage(page.pageNumberInFile);
      const operatorList = await pdfPage.getOperatorList();
      const { width, height } = pdfPage.getViewport({ scale: 1 });
      picture = describePicture(operatorList, pdfjs.OPS, width, height);
      pdfPage.cleanup();
    } catch {
      // A page that cannot be measured is treated as not being a picture, and
      // is not measured again.
    }
    found.set(pictureKey(page), picture);
  }
  return found;
}

/**
 * The pages to offer for text recognition: pictures of paper not read yet.
 *
 * A page with no text at all is one. So is a page with no invoice number whose
 * surface is mostly an image, whatever few words sit on top of it - unless its
 * own text is already a good reading of the paper, and a page with nothing in
 * the box is one of an invoice's pages after the first. That is so when the
 * page's own text names a client with a saved box, or when the page sits in an
 * invoice a box numbered and its own text covers the whole page, as a scanner's
 * own reading does.
 *
 * Sitting in a boxed invoice is not enough on its own: a scan with a few words
 * typed on top and no number is put with the invoice before it only until it
 * is read, and may well be the start of another. Each page carries how finely
 * it was scanned, which decides the size it is read at.
 *
 * @param {Array<object>} analyzed - the batch's pages, after detection.
 * @param {Map<string, { share: number, pixelsAcross: number }>} pictures - by pictureKey.
 * @param {Set<number>} [boxed] - pages of invoices whose number came from a box.
 * @returns {Array<object>}
 */
export function scansToRead(analyzed, pictures, boxed = new Set()) {
  return analyzed
    .filter(
      (page) =>
        !page.ocr &&
        (!page.hasText ||
          (!page.detection &&
            !(boxed.has(page.index) && textSpread(page) >= WHOLE_PAGE_SPREAD) &&
            !page.matchedProfiles?.some((profile) => profile.zone) &&
            isPicture(pictures.get(pictureKey(page)))))
    )
    .map((page) => ({ ...page, pixelsAcross: pictures.get(pictureKey(page))?.pixelsAcross ?? 0 }));
}
