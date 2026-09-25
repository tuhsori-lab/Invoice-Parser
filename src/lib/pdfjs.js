/**
 * pdf.js, set up to run entirely from this app's own files.
 *
 * The worker and the standard font data are bundled with the app rather than
 * fetched from a CDN, so opening a PDF makes no network request at all. That is
 * the whole point: a page of invoices never leaves the browser.
 */

import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/**
 * Metrics for the fonts a PDF is allowed to assume exist. Copied out of
 * node_modules by scripts/copy-pdfjs-assets.js, so they are served from here.
 */
const STANDARD_FONTS = `${import.meta.env.BASE_URL}pdfjs/standard_fonts/`;

export { pdfjs };
export const { TextLayer } = pdfjs;

/**
 * Open a PDF.
 *
 * @param {Uint8Array} bytes - the file's contents. pdf.js takes this over, so
 *   pass a copy if the caller still needs the original (pdf-lib does).
 * @returns {Promise<import('pdfjs-dist').PDFDocumentProxy>}
 */
export function openPdf(bytes) {
  return pdfjs.getDocument({
    data: bytes,
    standardFontDataUrl: STANDARD_FONTS,
    // No scripting, no external fetches, no eval: nothing this app needs.
    isEvalSupported: false,
    enableXfa: false,
  }).promise;
}
