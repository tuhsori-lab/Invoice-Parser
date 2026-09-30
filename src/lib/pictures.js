/**
 * Finding out which pages are pictures of paper.
 *
 * Only asked about pages that had no invoice number in their text, so an
 * ordinary batch of typed invoices hardly pays for it. The sums themselves are
 * in core/pictures.js; this is the part that asks pdf.js what a page draws.
 */

import { describePicture } from '../core/scans.js';
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
