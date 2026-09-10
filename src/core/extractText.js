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
 *   - a new line starts when the vertical position changes or pdf.js marks the
 *     run as ending a line.
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
 * @param {Array<object>} items - `textContent.items` from pdf.js.
 * @returns {{ text: string, hasText: boolean, lines: string[] }}
 */
export function buildPageText(items) {
  const lines = [];
  let line = null;

  for (const item of items || []) {
    if (!item || typeof item.str !== 'string') continue;

    // pdf.js emits empty runs purely to mark the end of a line.
    if (item.str === '') {
      if (item.hasEOL) line = null;
      continue;
    }

    const geometry = geometryOf(item);
    const sameLine =
      line !== null &&
      Math.abs(geometry.y - line.y) < SAME_LINE_RATIO * Math.max(line.fontSize, geometry.fontSize);

    if (sameLine) {
      const gap = geometry.x - line.endX;
      if (gap > SPACE_GAP_RATIO * geometry.fontSize) line.parts.push(' ');
      line.parts.push(item.str);
      line.endX = geometry.x + geometry.width;
      line.fontSize = Math.max(line.fontSize, geometry.fontSize);
    } else {
      line = {
        y: geometry.y,
        endX: geometry.x + geometry.width,
        fontSize: geometry.fontSize,
        parts: [item.str],
      };
      lines.push(line);
    }

    if (item.hasEOL) line = null;
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
