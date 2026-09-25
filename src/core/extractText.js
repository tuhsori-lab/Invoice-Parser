/**
 * Turning a PDF's text items back into readable lines.
 *
 * PDF files do not store text as lines. They store runs of glyphs, each with its
 * own position on the page. Joining those runs naively breaks invoice numbers:
 * a viewer shows "778812" but the file may hold "7788" and "12" as two runs, and
 * a plain join with spaces turns that into "7788 12".
 *
 * So we use the geometry of each run instead:
 *   - runs sit on the same line when their vertical positions differ by less
 *     than half the font size;
 *   - on a line, a space is inserted only when the horizontal gap between two
 *     runs is wider than 0.15x the font size;
 *   - a new line starts wherever the vertical position changes.
 *
 * Position decides, and the order the file happens to store its runs in does
 * not. pdf.js marks some runs as ending a line, and that mark is deliberately
 * not used: on a form-style invoice the whole blank form is drawn first, every
 * label ending a line of its own, and honouring those marks would keep each
 * label apart from the value printed beside it.
 *
 * This module is plain JavaScript. It takes the raw text items so it can be
 * tested without opening a PDF at all.
 */

/** A page with fewer readable characters than this has no usable text layer. */
export const MIN_TEXT_CHARS = 15;

/** Fraction of the font size that counts as a real gap between two runs. */
const SPACE_GAP_RATIO = 0.15;

/** Fraction of the font size that still counts as the same line. */
const SAME_LINE_RATIO = 0.5;

/** Font size used when an item carries no usable size of its own. */
const FALLBACK_FONT_SIZE = 10;

/**
 * Read position and size out of a pdf.js text item.
 *
 * @param {object} item - a pdf.js text item ({ str, transform, width, height }).
 * @returns {{ x: number, y: number, width: number, fontSize: number }}
 */
function geometryOf(item) {
  const transform = Array.isArray(item.transform) ? item.transform : [1, 0, 0, 1, 0, 0];
  const [scaleX, skewY, skewX, scaleYRaw, translateX, translateY] = transform;
  // The vertical scale of the text matrix is the drawn font size.
  const scaleY = Math.hypot(skewX, scaleYRaw) || Math.hypot(scaleX, skewY);
  const fontSize = Math.abs(item.height) || Math.abs(scaleY) || FALLBACK_FONT_SIZE;
  return {
    x: translateX,
    y: translateY,
    width: Math.abs(item.width) || 0,
    fontSize,
  };
}

/**
 * Rebuild the text of one page from its pdf.js text items.
 *
 * Lines are worked out from where the words sit on the page, not from the order
 * they appear in the file. Those two are not the same thing, and on real
 * invoices they are often nothing like it: accounting software draws the blank
 * form first - every label, in one go - and drops the values into their boxes
 * afterwards. Read in file order, such a page comes out as a list of headings
 * with all the numbers underneath, and "Invoice No." is followed by "Date"
 * rather than by the invoice number sitting beside it on the page.
 *
 * So every piece of text is placed by its coordinates, gathered into bands by
 * how far down the page it is, and read left to right within each band - which
 * is what a person looking at the page does.
 *
 * @param {Array<object>} items - `textContent.items` from pdf.js.
 * @returns {{ text: string, hasText: boolean, lines: string[] }}
 */
export function buildPageText(items) {
  const pieces = [];
  for (const item of items || []) {
    if (!item || typeof item.str !== 'string' || item.str === '') continue;
    const geometry = geometryOf(item);
    pieces.push({ str: item.str, ...geometry });
  }

  // Down the page first, then across it. Sorting up front means every piece of
  // one band arrives together, whatever order the file put them in.
  pieces.sort((a, b) => b.y - a.y || a.x - b.x);

  const lines = [];
  for (const piece of pieces) {
    const band = lines[lines.length - 1];
    // Measured against the band's first piece rather than its last, so a run of
    // slightly drifting positions cannot walk a band down the page.
    const sameBand =
      band &&
      Math.abs(piece.y - band.y) < SAME_LINE_RATIO * Math.max(band.fontSize, piece.fontSize);

    if (sameBand) {
      band.pieces.push(piece);
      band.fontSize = Math.max(band.fontSize, piece.fontSize);
    } else {
      lines.push({ y: piece.y, fontSize: piece.fontSize, pieces: [piece] });
    }
  }

  for (const band of lines) {
    band.pieces.sort((a, b) => a.x - b.x);
    const parts = [];
    let endX = null;
    for (const piece of band.pieces) {
      // A space only where there is a real gap: a number drawn as two runs has
      // no gap at all, and "7788" followed by "12" is one invoice number.
      if (endX !== null && piece.x - endX > SPACE_GAP_RATIO * piece.fontSize) parts.push(' ');
      parts.push(piece.str);
      endX = Math.max(endX ?? 0, piece.x + piece.width);
    }
    band.parts = parts;
  }

  const cleaned = lines
    .map((entry) => entry.parts.join('').replace(/\s+/g, ' ').trim())
    .filter((entry) => entry.length > 0);

  const text = cleaned.join('\n');
  return { text, hasText: countReadableCharacters(text) >= MIN_TEXT_CHARS, lines: cleaned };
}

/**
 * Count the characters that could carry meaning (everything except whitespace).
 *
 * @param {string} text
 * @returns {number}
 */
export function countReadableCharacters(text) {
  if (!text) return 0;
  return text.replace(/\s/g, '').length;
}

/**
 * Read the text of every page of an opened PDF.
 *
 * The document is duck-typed ({ numPages, getPage }) so this works with a pdf.js
 * document in the browser, in a worker, or in a test.
 *
 * @param {{ numPages: number, getPage: (n: number) => Promise<object> }} document
 * @param {object} [options]
 * @param {(done: number, total: number) => void} [options.onProgress]
 * @param {{ aborted: boolean }} [options.signal] - set `aborted` to stop early.
 * @returns {Promise<Array<{ pageNumber: number, text: string, hasText: boolean }>>}
 */
export async function extractDocumentText(document, options = {}) {
  const { onProgress, signal } = options;
  const pages = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    if (signal?.aborted) break;
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const { text, hasText } = buildPageText(content.items);
    pages.push({ pageNumber, text, hasText });
    page.cleanup?.();
    onProgress?.(pageNumber, document.numPages);
  }
  return pages;
}
