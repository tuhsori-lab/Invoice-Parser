/**
 * Rebuilding lines from the pieces of text a PDF actually stores.
 *
 * These tests use hand-made text items rather than a PDF, because the rules
 * being tested are about geometry: what counts as the same line, and what
 * counts as a space.
 */

import { describe, expect, it } from 'vitest';
import {
  buildPageText,
  buildRecognisedText,
  countReadableCharacters,
  MIN_TEXT_CHARS,
} from '../../src/core/extractText.js';
import { detectInZone } from '../../src/core/detect.js';

/** One piece of drawn text, the shape pdf.js hands over. */
function item(str, { x = 0, y = 700, width = null, size = 10, hasEOL = false } = {}) {
  return {
    str,
    transform: [size, 0, 0, size, x, y],
    width: width ?? str.length * size * 0.5,
    height: size,
    hasEOL,
  };
}

describe('joining pieces of text', () => {
  it('joins two runs with no gap between them, so an invoice number stays whole', () => {
    const { text } = buildPageText([
      item('Invoice #: ', { x: 50, width: 55 }),
      item('7788', { x: 105, width: 22 }),
      item('12', { x: 127, width: 11 }),
    ]);

    expect(text).toBe('Invoice #: 778812');
  });

  it('puts a space in when the gap is wider than a sixth of the font size', () => {
    const { text } = buildPageText([
      item('Invoice', { x: 50, width: 35 }),
      item('No', { x: 88, width: 12 }),
    ]);

    expect(text).toBe('Invoice No');
  });

  it('keeps runs on one line while they sit at about the same height', () => {
    const { text } = buildPageText([
      item('Invoice No.', { x: 50, y: 700 }),
      item('Date', { x: 180, y: 700.4 }),
    ]);

    expect(text).toBe('Invoice No. Date');
  });

  it('starts a new line when the text drops down the page', () => {
    const { text } = buildPageText([
      item('Invoice No.', { x: 50, y: 700 }),
      item('104501', { x: 50, y: 686 }),
    ]);

    expect(text).toBe('Invoice No.\n104501');
  });

  it('reads a band left to right, whatever order the file drew it in', () => {
    // What accounting software actually produces: the blank form first, every
    // label in one pass, and the values dropped in afterwards. The label and
    // its value sit side by side on the page but are far apart in the file.
    const { text } = buildPageText([
      item('INVOICE NO.', { x: 380, y: 700 }),
      item('DATE', { x: 380, y: 680 }),
      item('2071548', { x: 470, y: 700 }),
      item('03/04/26', { x: 470, y: 680 }),
    ]);

    expect(text).toBe('INVOICE NO. 2071548\nDATE 03/04/26');
  });

  it('pays no attention to a run being marked as ending a line', () => {
    // Position is the only thing that decides. Honouring these marks would
    // keep every label on a form apart from the value printed beside it.
    const { text } = buildPageText([
      item('Document Number', { x: 50, y: 700, hasEOL: true }),
      item('DN-90210', { x: 160, y: 700 }),
    ]);

    expect(text).toBe('Document Number DN-90210');
  });

  it('collapses runs of spaces and drops blank lines', () => {
    const { text } = buildPageText([
      item('Total    due', { x: 50, y: 700 }),
      item('   ', { x: 50, y: 660 }),
      item('254.00', { x: 50, y: 620 }),
    ]);

    expect(text).toBe('Total due\n254.00');
  });

  it('throws away the empty runs pdf.js uses to mark the end of a line', () => {
    const { text } = buildPageText([
      item('Invoice', { x: 50, y: 700 }),
      { str: '', hasEOL: true },
      item('445566', { x: 50, y: 686 }),
    ]);

    expect(text).toBe('Invoice\n445566');
  });
});

describe('telling a scanned page from a real one', () => {
  it('reports no usable text for a page with almost nothing on it', () => {
    const { hasText } = buildPageText([item('Page 3', { x: 50, y: 40 })]);

    expect(hasText).toBe(false);
  });

  it('reports usable text once there is enough of it to read', () => {
    const { hasText } = buildPageText([item('Invoice #: 104233', { x: 50, y: 700 })]);

    expect(hasText).toBe(true);
  });

  it('counts only the characters that carry meaning', () => {
    expect(countReadableCharacters('  a b\n c ')).toBe(3);
    expect(countReadableCharacters('')).toBe(0);
    expect('x'.repeat(MIN_TEXT_CHARS).length).toBe(MIN_TEXT_CHARS);
  });

  it('survives items that carry no geometry at all', () => {
    const { text } = buildPageText([{ str: 'Invoice 445566' }, null, { notAnItem: true }]);

    expect(text).toBe('Invoice 445566');
  });
});

describe('remembering where the text sat', () => {
  it('reports the characters each run covers and the space it took up', () => {
    const { text, layout } = buildPageText([
      item('Date', { x: 463, y: 710, width: 19, size: 9 }),
      item('Invoice #', { x: 522, y: 710, width: 36, size: 9 }),
    ]);

    expect(text).toBe('Date Invoice #');
    expect(layout).toEqual([
      { start: 0, end: 4, x: 463, endX: 482, y: 710, fontSize: 9, band: 0 },
      { start: 5, end: 14, x: 522, endX: 558, y: 710, fontSize: 9, band: 0 },
    ]);
  });

  it('numbers the bands so a later line can be told from the same one', () => {
    const { layout } = buildPageText([
      item('Invoice #', { x: 522, y: 710, width: 36, size: 9 }),
      item('SR-40881', { x: 517, y: 688, width: 45, size: 9 }),
    ]);

    expect(layout.map((span) => span.band)).toEqual([0, 1]);
  });

  it('counts the offsets from the start of the whole page, not of each line', () => {
    const { text, layout } = buildPageText([
      item('Invoice #', { x: 522, y: 710, width: 36, size: 9 }),
      item('SR-40881', { x: 517, y: 688, width: 45, size: 9 }),
    ]);

    const second = layout[1];
    expect(text.slice(second.start, second.end)).toBe('SR-40881');
  });
});

describe('text read from a scan', () => {
  // A page drawn 2480 pixels wide for reading: about 4.17 pixels to a point.
  const scale = 2480 / 595;
  const size = { scale, pageHeight: 841 };
  const px = (points) => Math.round(points * scale);

  /** A line of recognised words, each [text, left, right] in points, `top` in points from the top. */
  const line = (top, words, confidence = 91) => ({
    bbox: { x0: px(words[0][1]), y0: px(top), x1: px(words.at(-1)[2]), y1: px(top + 8) },
    words: words.map(([text, left, right]) => ({
      text,
      bbox: { x0: px(left), y0: px(top), x1: px(right), y1: px(top + 8) },
      confidence,
    })),
  });

  const header = [
    line(130, [
      ['N°', 408, 418],
      ['Document', 420, 462],
    ]),
    line(145, [
      ['(00871)', 330, 366],
      ['Invoice', 372, 404],
      ['Nr.', 408, 420],
      ['2031/VT/00412', 427, 488],
      ['11/06/31', 504, 541],
    ]),
  ];

  it('reads the words back in lines, top to bottom', () => {
    const { text, hasText } = buildRecognisedText(header, size);

    expect(text).toBe('N° Document\n(00871) Invoice Nr. 2031/VT/00412 11/06/31');
    expect(hasText).toBe(true);
  });

  it('puts each word where it sat on the page, measured up from the bottom', () => {
    const { text, layout } = buildRecognisedText(header, size);
    const number = layout.find((span) => text.slice(span.start, span.end) === '2031/VT/00412');

    expect(number.x).toBeCloseTo(427, 0);
    expect(number.endX).toBeCloseTo(488, 0);
    expect(number.y).toBeCloseTo(841 - 153, 0);
  });

  it('keeps how sure recognition was of every word', () => {
    const { layout } = buildRecognisedText([line(145, [['2031/VT/00412', 427, 488]], 38)], size);

    expect(layout[0].confidence).toBe(38);
  });

  it('lets a box drawn on the scan be read like one on any other page', () => {
    const { text, layout } = buildRecognisedText(header, size);
    const spot = { x0: 425 / 595, x1: 490 / 595, y0: (841 - 154) / 841, y1: (841 - 144) / 841 };

    expect(detectInZone(text, layout, spot, { width: 595, height: 841 }, 'D4 / A2 / D5')).toBe(
      '2031/VT/00412'
    );
  });

  it('gives an empty page for an empty reading', () => {
    expect(buildRecognisedText([], size)).toMatchObject({ text: '', hasText: false, layout: [] });
    expect(buildRecognisedText(undefined, size).text).toBe('');
  });
});
