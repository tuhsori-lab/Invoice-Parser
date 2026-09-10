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
  countReadableCharacters,
  MIN_TEXT_CHARS,
} from '../../src/core/extractText.js';

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

  it('starts a new line when pdf.js says the line ended', () => {
    const { text } = buildPageText([
      item('Document Number', { x: 50, y: 700, hasEOL: true }),
      item('DN-90210', { x: 50, y: 700 }),
    ]);

    expect(text).toBe('Document Number\nDN-90210');
  });

  it('collapses runs of spaces and drops blank lines', () => {
    const { text } = buildPageText([
      item('Total    due', { x: 50, y: 700 }),
      item('   ', { x: 50, y: 660 }),
      item('254.00', { x: 50, y: 620 }),
    ]);

    expect(text).toBe('Total due\n254.00');
  });

  it('ignores the empty runs pdf.js uses to mark the end of a line', () => {
    const { text } = buildPageText([
      item('Invoice', { x: 50, y: 700 }),
      { str: '', hasEOL: true },
      item('445566', { x: 50, y: 700 }),
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
