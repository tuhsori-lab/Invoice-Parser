/**
 * Reading the PDFs a person dropped in.
 *
 * Text is pulled out page by page so a progress bar can move and a Cancel
 * button can stop the job. The text is then kept in memory for the rest of the
 * session: changing a setting re-runs detection over the text that is already
 * there, and never reads the PDF again.
 */

import { buildPageText } from '../core/extractText.js';
import { classifyError } from '../core/errors.js';
import { openPdf } from './pdfjs.js';

/** How many pages to read before letting the browser draw a frame. */
const CHUNK = 5;

let fileCounter = 0;

/** Let the browser paint between chunks of work. */
function yieldToBrowser() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * @typedef {object} LoadedFile
 * @property {string} id
 * @property {string} name
 * @property {number} size in bytes.
 * @property {number} pageCount
 * @property {Uint8Array} bytes kept so pdf-lib can build the output PDFs.
 * @property {object} doc the pdf.js document, kept for rendering pages.
 */

/**
 * Read every page of every file.
 *
 * @param {File[]} inputFiles - in the order the user chose them.
 * @param {object} [options]
 * @param {(progress: { done: number, total: number, fileName: string }) => void} [options.onProgress]
 * @param {{ aborted: boolean }} [options.signal] - set `aborted` to stop.
 * @returns {Promise<{ files: LoadedFile[], pages: Array<object>, problems: Array<object> }>}
 */
export async function loadBatch(inputFiles, options = {}) {
  const { onProgress, signal } = options;
  const files = [];
  const pages = [];
  const problems = [];

  // Two passes: open every file first, so the progress bar knows the real total.
  const opened = [];
  for (const file of inputFiles) {
    if (signal?.aborted) break;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      // pdf.js takes ownership of the array it is given, so it gets a copy and
      // the original stays available for building the output PDFs.
      const doc = await openPdf(bytes.slice());
      fileCounter += 1;
      opened.push({
        id: `file-${fileCounter}`,
        name: file.name,
        size: file.size,
        pageCount: doc.numPages,
        bytes,
        doc,
      });
    } catch (error) {
      problems.push({ fileName: file.name, kind: classifyError(error) });
    }
  }

  const total = opened.reduce((sum, file) => sum + file.pageCount, 0);
  let done = 0;

  for (const file of opened) {
    if (signal?.aborted) break;
    files.push(file);

    for (let pageNumber = 1; pageNumber <= file.pageCount; pageNumber += 1) {
      if (signal?.aborted) break;
      const page = await file.doc.getPage(pageNumber);
      const content = await page.getTextContent();
      const { text, hasText, layout } = buildPageText(content.items);
      page.cleanup();

      pages.push({
        index: pages.length + 1,
        fileId: file.id,
        fileName: file.name,
        filePageIndex: pageNumber - 1,
        pageNumberInFile: pageNumber,
        text,
        hasText,
        layout,
        ocr: false,
      });

      done += 1;
      if (done % CHUNK === 0 || done === total) {
        onProgress?.({ done, total, fileName: file.name });
        await yieldToBrowser();
      }
    }
  }

  return { files, pages, problems };
}

/**
 * Close the pdf.js documents of a batch that is being replaced.
 *
 * @param {LoadedFile[]} files
 */
export function closeBatch(files = []) {
  for (const file of files) {
    try {
      file.doc?.destroy();
    } catch {
      // A document that is already gone needs no closing.
    }
  }
}
