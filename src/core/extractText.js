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
 * Flattening a page to lines throws away which column a word was in, and that
 * turns out to matter: a label can be a column heading, with its value printed
 * underneath rather than beside it, and some unrelated text can sit at that same
 * height on the far side of the page. So alongside the text this module returns
 * a `layout`: for every run, the characters it occupies in the text and the
 * space it occupied on the page. detect.js uses that to tell a value standing in
 * a label's column from one that merely follows it in reading order, and to read
 * whatever stands in a region of the page somebody pointed at.
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
 * Gather the runs of a page into bands, one per line of print.
 *
 * @param {Array<object>} items
 * @returns {Array<{ y: number, fontSize: number, pieces: Array<object> }>}
 */
function bandsOf(items) {
  const pieces = [];
  for (const item of items || []) {
    if (!item || typeof item.str !== 'string' || item.str === '') continue;
    const geometry = geometryOf(item);
    const piece = { str: item.str, ...geometry };
    // Words read from a scan say how sure recognition was of them.
    if (typeof item.confidence === 'number') piece.confidence = item.confidence;
    pieces.push(piece);
  }

  // Down the page first, then across it. Sorting up front means every piece of
  // one band arrives together, whatever order the file put them in.
  pieces.sort((a, b) => b.y - a.y || a.x - b.x);

  const bands = [];
  for (const piece of pieces) {
    const band = bands[bands.length - 1];
    // Measured against the band's first piece rather than its last, so a run of
    // slightly drifting positions cannot walk a band down the page.
    const sameBand =
      band &&
      Math.abs(piece.y - band.y) < SAME_LINE_RATIO * Math.max(band.fontSize, piece.fontSize);

    if (sameBand) {
      band.pieces.push(piece);
      band.fontSize = Math.max(band.fontSize, piece.fontSize);
    } else {
      bands.push({ y: piece.y, fontSize: piece.fontSize, pieces: [piece] });
    }
  }
  return bands;
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
 * @returns {{ text: string, hasText: boolean, lines: string[], layout: Array<object> }}
 */
export function buildPageText(items) {
  const lines = [];
  const layout = [];
  let offset = 0;

  for (const band of bandsOf(items)) {
    band.pieces.sort((a, b) => a.x - b.x);

    let line = '';
    const spans = [];
    let endX = null;

    for (const piece of band.pieces) {
      // A space only where there is a real gap: a number drawn as two runs has
      // no gap at all, and "7788" followed by "12" is one invoice number.
      const gap = endX !== null && piece.x - endX > SPACE_GAP_RATIO * piece.fontSize;
      endX = Math.max(endX ?? piece.x, piece.x + piece.width);

      let str = piece.str.replace(/\s+/g, ' ');
      if (line === '') str = str.replace(/^ +/, '');
      else if (gap && !line.endsWith(' ') && !str.startsWith(' ')) line += ' ';
      else if (line.endsWith(' ')) str = str.replace(/^ +/, '');
      if (str === '') continue;

      spans.push({
        start: line.length,
        end: line.length + str.length,
        x: piece.x,
        endX: piece.x + piece.width,
        y: piece.y,
        fontSize: piece.fontSize,
        confidence: piece.confidence,
      });
      line += str;
    }

    const trimmed = line.trimEnd();
    if (trimmed === '') continue;

    const bandIndex = lines.length;
    for (const span of spans) {
      if (span.start >= trimmed.length) continue;
      const placed = {
        start: offset + span.start,
        end: offset + Math.min(span.end, trimmed.length),
        x: span.x,
        endX: span.endX,
        y: span.y,
        fontSize: span.fontSize,
        band: bandIndex,
      };
      if (span.confidence !== undefined) placed.confidence = span.confidence;
      layout.push(placed);
    }

    lines.push(trimmed);
    offset += trimmed.length + 1;
  }

  const text = lines.join('\n');
  return { text, hasText: countReadableCharacters(text) >= MIN_TEXT_CHARS, lines, layout };
}

/**
 * Put back together a word that recognition split at a slash.
 *
 * Reading a page as scattered text, recognition sometimes sees a little gap
 * before or after a slash and makes two words of one: "2026 /FX/00940", or
 * "2026/ FX/00940", or "2026 / FX/00940". A slash never starts or ends a word on
 * an invoice, so a word that starts with one is joined to the word before it,
 * and a word that ends with one to the word after - when they sit close, no
 * more than a line's height apart.
 *
 * @param {Array<{ text: string, bbox: object, confidence?: number }>} words - one line's.
 * @param {number} lineHeight - in the same pixels as the boxes.
 * @returns {Array<{ text: string, bbox: object, confidence?: number }>}
 */
export function joinSlashedWords(words, lineHeight) {
  const joined = [];
  for (const word of words) {
    const text = String(word?.text ?? '').trim();
    const before = joined[joined.length - 1];
    const close =
      before?.bbox &&
      word?.bbox &&
      word.bbox.x0 - before.bbox.x1 <= Math.max(lineHeight, 1) &&
      word.bbox.x0 >= before.bbox.x0;
    const beforeText = String(before?.text ?? '');
    const slashBetween =
      (text.startsWith('/') && /[A-Za-z0-9]$/.test(beforeText)) ||
      (beforeText.endsWith('/') && /^[A-Za-z0-9/]/.test(text) && beforeText.length > 0);
    if (text && close && slashBetween) {
      joined[joined.length - 1] = {
        ...before,
        text: `${beforeText}${text}`,
        bbox: {
          x0: before.bbox.x0,
          y0: Math.min(before.bbox.y0, word.bbox.y0),
          x1: word.bbox.x1,
          y1: Math.max(before.bbox.y1, word.bbox.y1),
        },
        ...(typeof before.confidence === 'number' && typeof word.confidence === 'number'
          ? { confidence: Math.min(before.confidence, word.confidence) }
          : {}),
      };
    } else {
      joined.push(word);
    }
  }
  return joined;
}

/**
 * Rebuild the text of a page that was read by text recognition, keeping where
 * every word sat.
 *
 * Recognition reports lines of words, each word with a box in pixels of the
 * picture it was given, measured down from the top. Those are turned into the
 * same kind of runs a PDF gives - in the page's own units, measured up from the
 * bottom - and read exactly as a PDF's are. So a scanned page gets a layout like
 * any other: a label that is a column heading, or a box somebody drew around the
 * number, works on a scan as well.
 *
 * Every word stands on the bottom of its line's box and is as tall as the line,
 * so the words recognition put on one line always stay on one line here. How
 * sure recognition was of each word, from 0 to 100, is kept alongside it.
 *
 * @param {Array<{ bbox: object, words: Array<{ text: string, bbox: object, confidence?: number }> }>} lines
 *   boxes are { x0, y0, x1, y1 } in pixels, y measured down from the top.
 * @param {{ scale: number, pageHeight: number }} size - pixels per unit of the
 *   page, and the page's own height.
 * @returns {{ text: string, hasText: boolean, lines: string[], layout: Array<object> }}
 */
export function buildRecognisedText(lines = [], { scale = 1, pageHeight = 0 } = {}) {
  const items = [];
  for (const line of lines ?? []) {
    const box = line?.bbox;
    if (!box || !scale) continue;
    const bottom = pageHeight - box.y1 / scale;
    const tall = Math.max((box.y1 - box.y0) / scale, 1);
    for (const word of joinSlashedWords(line.words ?? [], box.y1 - box.y0)) {
      const str = String(word?.text ?? '').trim();
      if (!str || !word.bbox) continue;
      const item = {
        str,
        transform: [tall, 0, 0, tall, word.bbox.x0 / scale, bottom],
        width: (word.bbox.x1 - word.bbox.x0) / scale,
        height: tall,
      };
      if (typeof word.confidence === 'number') item.confidence = word.confidence;
      items.push(item);
    }
  }
  return buildPageText(items);
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
 * @returns {Promise<Array<object>>} one entry per page: its text, whether that
 *   text is usable, where each run sat, and the page's own size.
 */
export async function extractDocumentText(document, options = {}) {
  const { onProgress, signal } = options;
  const pages = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    if (signal?.aborted) break;
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const { text, hasText, layout } = buildPageText(content.items);
    const { width, height } = page.getViewport({ scale: 1 });
    pages.push({ pageNumber, text, hasText, layout, pageWidth: width, pageHeight: height });
    page.cleanup?.();
    onProgress?.(pageNumber, document.numPages);
  }
  return pages;
}
