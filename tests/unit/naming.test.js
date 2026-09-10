/**
 * What each invoice gets called.
 *
 * File names are the part of this app people notice first, and a bad one costs
 * real time: a name Windows refuses, a name that overwrites the invoice before
 * it, or a name with no clue where the pages came from.
 */

import { describe, expect, it } from 'vitest';
import {
  assignFileNames,
  buildFileName,
  fillTemplate,
  MAX_FILENAME_LENGTH,
  pageRangeForCsv,
  pageRangeForName,
  pageRuns,
  sanitizeFileName,
} from '../../src/core/naming.js';

/** A finished group, as group.js hands it over. */
function group(invoice, pageNumbers, extras = {}) {
  return {
    invoice,
    pages: pageNumbers.map((index) => ({ index, fileName: 'batch.pdf' })),
    extra: extras.extra ? { value: extras.extra, label: 'PO #' } : null,
    client: extras.client ?? '',
    flags: extras.flags ?? [],
  };
}

const nameOf = (...args) => buildFileName(...args);

describe('page ranges', () => {
  it('finds the runs in a list of pages', () => {
    expect(pageRuns([1, 2, 3, 7])).toEqual([
      [1, 3],
      [7, 7],
    ]);
  });

  it('writes ranges the long way for the CSV, because Excel reads 1-3 as a date', () => {
    expect(pageRangeForCsv([1, 2, 3, 7])).toBe('1 to 3, 7');
    expect(pageRangeForCsv([4])).toBe('4');
  });

  it('writes ranges compactly for file names', () => {
    expect(pageRangeForName([5, 6])).toBe('5-6');
    expect(pageRangeForName([5, 6, 9])).toBe('5-6+9');
  });

  it('puts pages in order and ignores repeats', () => {
    expect(pageRangeForCsv([3, 1, 2, 2])).toBe('1 to 3');
  });
});

describe('names Windows will accept', () => {
  it('replaces every character Windows refuses', () => {
    expect(sanitizeFileName('INV<1>2:3"4/5\\6|7?8*9')).toBe('INV-1-2-3-4-5-6-7-8-9');
  });

  it('leaves spaces alone, because Windows allows them', () => {
    expect(sanitizeFileName('Invoice 104233 Northwind')).toBe('Invoice 104233 Northwind');
  });

  it('keeps clear of the names Windows reserves for devices', () => {
    expect(sanitizeFileName('CON')).toBe('_CON');
    expect(sanitizeFileName('lpt1')).toBe('_lpt1');
  });

  it('trims separators from both ends and collapses runs of them', () => {
    expect(sanitizeFileName('  __INV--104233..  ')).toBe('INV-104233');
  });

  it('always gives back something usable', () => {
    expect(sanitizeFileName('///')).toBe('invoice');
    expect(sanitizeFileName('')).toBe('invoice');
  });
});

describe('the file name template', () => {
  it('drops the separator next to a token with nothing in it', () => {
    expect(fillTemplate('{prefix}{invoice}_{extra}', { invoice: '104233', extra: '' })).toBe(
      '104233'
    );
    expect(fillTemplate('{prefix}{invoice}_{extra}', { invoice: '104233', extra: 'PO-9' })).toBe(
      '104233_PO-9'
    );
  });

  it('fills in every token the app offers', () => {
    const name = nameOf(group('104233', [5, 6], { extra: 'PO-9', client: 'Northwind Traders' }), {
      template: '{client}-{invoice}-{extra}-p{pages}-{index}',
      index: 7,
      total: 40,
    });

    expect(name).toBe('Northwind Traders-104233-PO-9-p5-6-07.pdf');
  });

  it('pads the invoice number so a batch sorts in order', () => {
    expect(nameOf(group('9', [1]), { template: '{index}-{invoice}', index: 9, total: 120 })).toBe(
      '009-9.pdf'
    );
  });

  it('puts the prefix the user typed in front', () => {
    expect(nameOf(group('104233', [1]), { prefix: 'Northwind ' })).toBe('Northwind 104233.pdf');
  });

  it('names an invoice with no number after its pages', () => {
    expect(nameOf(group(null, [5, 6]))).toBe('NO-NUMBER_p5-6.pdf');
  });

  it('cuts a very long name down to size', () => {
    const name = nameOf(group('X'.repeat(400), [1]));

    expect(name.length).toBe(MAX_FILENAME_LENGTH);
    expect(name.endsWith('.pdf')).toBe(true);
  });
});

describe('two invoices that want the same name', () => {
  it('numbers the later ones instead of overwriting', () => {
    const named = assignFileNames([group('1001', [1]), group('1001', [2]), group('1001', [3])]);

    expect(named.map((entry) => entry.fileName)).toEqual([
      '1001.pdf',
      '1001 (2).pdf',
      '1001 (3).pdf',
    ]);
  });

  it('flags every invoice in the clash, not just the later ones', () => {
    const named = assignFileNames([group('1001', [1]), group('1001', [2]), group('1002', [3])]);

    expect(named[0].flags).toContain('duplicate-name');
    expect(named[1].flags).toContain('duplicate-name');
    expect(named[2].flags).not.toContain('duplicate-name');
  });

  it('treats names that differ only in capitals as the same name', () => {
    const named = assignFileNames([group('inv-1', [1]), group('INV-1', [2])]);

    expect(named[1].fileName).toBe('INV-1 (2).pdf');
  });

  it('keeps a numbered name within the length limit', () => {
    const long = 'Y'.repeat(400);
    const named = assignFileNames([group(long, [1]), group(long, [2])]);

    expect(named[1].fileName.length).toBeLessThanOrEqual(MAX_FILENAME_LENGTH);
    expect(named[1].fileName.endsWith(' (2).pdf')).toBe(true);
  });

  it('leaves the flags alone when nothing clashes', () => {
    const named = assignFileNames([group('1001', [1], { flags: ['fallback'] })]);

    expect(named[0].flags).toEqual(['fallback']);
  });
});
