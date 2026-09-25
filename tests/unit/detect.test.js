/**
 * Which number is the invoice number, and why.
 *
 * The rules here are the ones that stop the app from being confidently wrong:
 * not reading a street number as an invoice number, not reading a date as one,
 * and not reading "Invoice Notes: 100 units" as invoice 100.
 */

import { describe, expect, it } from 'vitest';
import {
  compileCustomPattern,
  detectCandidates,
  detectFieldValue,
  detectInvoiceNumber,
  hasConflict,
  isDateShaped,
  normalizeValue,
} from '../../src/core/detect.js';
import { buildPageText } from '../../src/core/extractText.js';

describe('the order the tiers are tried in', () => {
  it('prefers a profile label over an everyday one', () => {
    const text = 'Our Ref 889900\nInvoice No: 111222';

    expect(detectInvoiceNumber(text, { profileLabels: ['Our Ref'] })).toEqual({
      value: '889900',
      label: 'Our Ref',
      source: 'profile',
    });
  });

  it('tries profile labels in the order the user put them in', () => {
    const text = 'Statement Ref CS-7702\nOur Ref NW-5501';

    expect(detectInvoiceNumber(text, { profileLabels: ['Our Ref', 'Statement Ref'] })?.value).toBe(
      'NW-5501'
    );
    expect(detectInvoiceNumber(text, { profileLabels: ['Statement Ref', 'Our Ref'] })?.value).toBe(
      'CS-7702'
    );
  });

  it('falls back to the bare word "Invoice" only when nothing else matched', () => {
    expect(detectInvoiceNumber('INVOICE 445566')).toEqual({
      value: '445566',
      label: 'INVOICE',
      source: 'bare',
    });
    expect(detectInvoiceNumber('INVOICE 445566\nInv No: A-10045')?.source).toBe('common');
  });

  it('lets a user pattern replace every other tier', () => {
    const text = 'Invoice No: 111222\nJob code 98-7766';

    expect(detectInvoiceNumber(text, { customPattern: 'Job code ([0-9-]+)' })).toEqual({
      value: '98-7766',
      label: 'Job code',
      source: 'custom',
    });
  });

  it('can be told to skip the everyday labels', () => {
    expect(detectInvoiceNumber('Invoice No: 111222', { useCommonLabels: false })).toBeNull();
  });
});

describe('everyday labels', () => {
  const found = (text) => detectInvoiceNumber(text);

  it.each([
    ['Invoice #: 104233', '104233', 'Invoice #:'],
    ['Invoice No. 104501', '104501', 'Invoice No.'],
    ['Inv#: A-10045', 'A-10045', 'Inv#:'],
    ['Inv. No.: 3344', '3344', 'Inv. No.:'],
    ['Bill No. 55667', '55667', 'Bill No.'],
    ['Billing Ref: BR-8890', 'BR-8890', 'Billing Ref:'],
    ['Document Number\nDN-90210', 'DN-90210', 'Document Number'],
    ['Doc ID 55123', '55123', 'Doc ID'],
    ['Credit Memo No: CM-4410', 'CM-4410', 'Credit Memo No:'],
    ['Debit Memo #: DM-99', 'DM-99', 'Debit Memo #:'],
  ])('reads %s', (text, value, label) => {
    expect(found(text)).toEqual({ value, label, source: 'common' });
  });

  it('will not read "Invoice Notes" as a label, because "no" must be a whole word', () => {
    expect(found('Invoice Notes: 100 units held back')).toBeNull();
  });

  it('will not start a label in the middle of a word', () => {
    expect(found('Reinvoice No 12345')).toBeNull();
  });

  it('skips a date printed between the label and the number', () => {
    expect(found('Invoice Date: 09/04/26   Invoice No: 3344')?.value).toBe('3344');
    expect(found('Invoice No:\n09-01-2026\n104233')?.value).toBe('104233');
    expect(found('Invoice No: Sep 4, 2026 104233')?.value).toBe('104233');
  });

  it('reads past heading words to the values on the line below', () => {
    expect(found('Invoice No.   Date   Terms\n104501   09/04/2026   Net 30')?.value).toBe('104501');
  });

  it('ignores runs that are too short or have no digit in them', () => {
    expect(found('Invoice No: ok 42 fine 104233')?.value).toBe('104233');
  });

  it('gives up rather than reaching across the page for a value', () => {
    const farAway = `Invoice No: ${'terms and conditions apply '.repeat(4)}104233`;

    expect(found(farAway)).toBeNull();
  });

  it('tidies the value it finds', () => {
    expect(found('Invoice #: a-10045-')?.value).toBe('A-10045');
    expect(normalizeValue('inv-77--')).toBe('INV-77');
  });
});

describe('the bare "Invoice" tier', () => {
  it('reads a number printed directly after the word', () => {
    expect(detectInvoiceNumber('INVOICE 445566\n1234 Maple Street')?.value).toBe('445566');
  });

  it('never looks past the end of the line', () => {
    expect(detectInvoiceNumber('INVOICE\n1234 Maple Street\nSpringfield, IL 62704')).toBeNull();
  });

  it('will not take a word that happens to follow the title', () => {
    expect(detectInvoiceNumber('Invoice Summary for August')).toBeNull();
  });

  it('skips an occurrence with nothing usable after it and tries the next', () => {
    expect(detectInvoiceNumber('INVOICE\nSee invoice 445566 for details')?.value).toBe('445566');
  });
});

describe('dates', () => {
  it.each(['09-01-2026', '2026-09-01', '09/04/26', '9.4.2026'])('knows %s is a date', (token) => {
    expect(isDateShaped(token)).toBe(true);
  });

  it.each(['104233', 'A-10045', 'INV-2001'])('knows %s is not a date', (token) => {
    expect(isDateShaped(token)).toBe(false);
  });
});

describe('two numbers on one page', () => {
  it('reports both when the labels differ', () => {
    const candidates = detectCandidates('Invoice No: 1111\nBill No: 2222');

    expect(candidates.map((hit) => hit.value)).toEqual(['1111', '2222']);
    expect(hasConflict(candidates)).toBe(true);
  });

  it('is not a conflict when the same label repeats with the same value', () => {
    const candidates = detectCandidates('Invoice #: 100777\nInvoice #: 100777');

    expect(hasConflict(candidates)).toBe(false);
  });
});

describe('a pattern typed by the user', () => {
  it('explains a pattern that cannot be read', () => {
    const { regex, error } = compileCustomPattern('Ref (([0-9]+)');

    expect(regex).toBeNull();
    expect(error).toMatch(/could not be read/i);
  });

  it('explains a pattern with nothing captured', () => {
    const { regex, error } = compileCustomPattern('Ref [0-9]+');

    expect(regex).toBeNull();
    expect(error).toMatch(/capture group/i);
  });

  it('accepts an empty pattern without complaining', () => {
    expect(compileCustomPattern('')).toEqual({ regex: null, error: null });
  });
});

describe('extra fields', () => {
  it('reads a PO number with the same rule as an invoice number', () => {
    expect(detectFieldValue('PO #: 445-9921\nInvoice #: 104233', 'PO #')).toEqual({
      value: '445-9921',
      label: 'PO #:',
    });
  });

  it('tries several labels in order and reports the one that worked', () => {
    expect(detectFieldValue('Store number 4471', ['PO #', 'Store number'])?.value).toBe('4471');
  });

  it('gives nothing back when the label is not on the page', () => {
    expect(detectFieldValue('Invoice #: 104233', 'PO #')).toBeNull();
  });
});

describe('pages with nothing on them', () => {
  it.each([
    ['', 'empty'],
    ['   \n  ', 'blank'],
  ])('finds no number on a %s page', (text) => {
    expect(detectInvoiceNumber(text)).toBeNull();
    expect(detectCandidates(text)).toEqual([]);
  });
});

describe('a label that is a column heading', () => {
  /** One piece of drawn text, the shape pdf.js hands over. */
  function item(str, { x, y, width, size = 9 }) {
    return { str, transform: [size, 0, 0, size, x, y], width, height: size };
  }

  /**
   * The top of an invoice that heads a narrow column "Invoice #" and prints the
   * number in the row below it, with the company's own address running down the
   * far left at those same two heights. Read as lines this comes out as:
   *
   *   3RD FLOOR Date Invoice #
   *   SPRINGFIELD, IL 62704 09/22/26 SR-40881
   *
   * so the first number-shaped thing after the label is the postcode.
   */
  const page = () =>
    buildPageText([
      item('3RD FLOOR', { x: 56, y: 707, width: 65, size: 12 }),
      item('Date', { x: 463, y: 710, width: 19 }),
      item('Invoice #', { x: 522, y: 710, width: 36 }),
      item('SPRINGFIELD, IL 62704', { x: 56, y: 692, width: 120, size: 12 }),
      item('09/22/26', { x: 454, y: 688, width: 37 }),
      item('SR-40881', { x: 517, y: 688, width: 45 }),
    ]);

  it('reads the value standing in the labeled column, not the one merely next in the line', () => {
    const { text, layout } = page();

    expect(detectInvoiceNumber(text, { layout })).toEqual({
      value: 'SR-40881',
      label: 'Invoice #',
      source: 'common',
    });
  });

  it('would read the postcode if it went by reading order alone', () => {
    // Guards the test above: without the layout there is nothing to tell the
    // postcode from the invoice number, and this is the answer that was wrong
    // on a real batch.
    const { text } = page();

    expect(detectInvoiceNumber(text)?.value).toBe('62704');
  });

  it('still takes a value sitting beside its label on the same line', () => {
    const { text, layout } = buildPageText([
      item('INVOICE NO.', { x: 380, y: 700, width: 55 }),
      item('1043396', { x: 470, y: 700, width: 40 }),
      item('Northwind Traders', { x: 56, y: 700, width: 90 }),
    ]);

    expect(detectInvoiceNumber(text, { layout })?.value).toBe('1043396');
  });

  it('allows a value a little wider than its heading', () => {
    const { text, layout } = buildPageText([
      item('Invoice No', { x: 500, y: 700, width: 40 }),
      item('A-99812', { x: 496, y: 684, width: 48 }),
    ]);

    expect(detectInvoiceNumber(text, { layout })?.value).toBe('A-99812');
  });
});

describe('a number with a suffix', () => {
  it('keeps an underscore suffix, because it is part of the number', () => {
    // Accounting software prints a revision or print count this way, and two
    // invoices can differ by nothing else.
    expect(detectInvoiceNumber('Invoice # 19205594_2')?.value).toBe('19205594_2');
  });

  it('tells two invoices apart by their suffix alone', () => {
    expect(detectInvoiceNumber('Invoice # BROR1054_1')?.value).not.toBe(
      detectInvoiceNumber('Invoice # BROR1054_4')?.value
    );
  });

  it('keeps a suffix on a value the bare tier found', () => {
    expect(detectInvoiceNumber('Invoice 445566_3', { useCommonLabels: false })).toEqual({
      value: '445566_3',
      label: 'Invoice',
      source: 'bare',
    });
  });

  it('leaves no underscore or hyphen dangling on the end', () => {
    expect(normalizeValue('4455_')).toBe('4455');
    expect(normalizeValue('4455-')).toBe('4455');
    expect(normalizeValue('44_55')).toBe('44_55');
  });

  it('still refuses something with no digit in it at all', () => {
    expect(detectInvoiceNumber('Invoice No: DRAFT_COPY')).toBeNull();
  });
});
