/**
 * Reading a person's own list of invoice numbers, and checking numbers against it.
 * Every number here is invented.
 */

import { describe, expect, it } from 'vitest';
import {
  buildKnownList,
  checkNumber,
  guessColumns,
  lookAlikeKey,
  oneEditApart,
  parseCsv,
  rowsFromSpreadsheetXml,
} from '../../src/core/knownList.js';

describe('reading a CSV', () => {
  it('reads plain rows, quoted cells and a byte order mark', () => {
    const rows = parseCsv(
      '﻿Invoice,Customer\r\n104233,"Lakeshore, Inc."\n"SO-80155","He said ""hi"""\n'
    );
    expect(rows).toEqual([
      ['Invoice', 'Customer'],
      ['104233', 'Lakeshore, Inc.'],
      ['SO-80155', 'He said "hi"'],
    ]);
  });

  it('reads the semicolons Excel writes in much of Europe, and tabs', () => {
    expect(parseCsv('Invoice;Client\n2031/TB/00412;Vallombrosa')).toEqual([
      ['Invoice', 'Client'],
      ['2031/TB/00412', 'Vallombrosa'],
    ]);
    expect(parseCsv('a\tb\n1\t2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('skips empty lines', () => {
    expect(parseCsv('Invoice\n\n104233\n,\n')).toEqual([['Invoice'], ['104233']]);
  });
});

describe('reading an Excel sheet', () => {
  const sharedStrings =
    '<sst><si><t>Invoice No</t></si><si><t>Client</t></si><si><r><t>SO-</t></r><r><t>80155</t></r></si>' +
    '<si><t>Osbourne &amp; Bligh</t></si></sst>';
  const sheet =
    '<worksheet><sheetData>' +
    '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>' +
    '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="C2" t="s"><v>3</v></c></row>' +
    '<row r="3"><c r="A3"><v>4.0017822E7</v></c><c r="C3" t="inlineStr"><is><t>Kestrel</t></is></c></row>' +
    '</sheetData></worksheet>';

  it('reads shared strings, inline strings and numbers into the right columns', () => {
    expect(rowsFromSpreadsheetXml({ sheet, sharedStrings })).toEqual([
      ['Invoice No', '', 'Client'],
      ['SO-80155', '', 'Osbourne & Bligh'],
      ['40017822', '', 'Kestrel'],
    ]);
  });
});

describe('choosing the columns', () => {
  it('finds the invoice and client columns by their headings', () => {
    const guess = guessColumns([
      ['Date', 'Customer name', 'Invoice #', 'Amount'],
      ['01/03/31', 'Tidewater', '104233', '640.00'],
    ]);
    expect(guess).toMatchObject({ hasHeader: true, invoiceColumn: 2, clientColumn: 1 });
  });

  it('falls back to the column with the most numbers in it when there is no heading', () => {
    const guess = guessColumns([
      ['Tidewater', '104233'],
      ['Kestrel', '104301'],
    ]);
    expect(guess).toMatchObject({ hasHeader: false, invoiceColumn: 1, clientColumn: null });
  });
});

describe('checking a number', () => {
  const list = buildKnownList(
    [
      ['Invoice', 'Client'],
      ['SO-80155', 'Osbourne & Bligh'],
      ['104233', 'Lakeshore'],
      ['104301', 'Lakeshore'],
      ['40017822', 'Kestrel'],
      ['40017822_2', 'Kestrel'],
    ],
    { invoiceColumn: 0, clientColumn: 1, hasHeader: true }
  );

  it('verifies a number that is in the list, whatever its case or spacing', () => {
    expect(checkNumber('so-80155', list)).toEqual({ status: 'verified' });
    expect(checkNumber(' 104233 ', list)).toEqual({ status: 'verified' });
  });

  it('suggests the entry a look-alike misreading came from', () => {
    expect(checkNumber('S0-80155', list)).toEqual({
      status: 'near',
      suggestion: 'SO-80155',
      why: 'look-alike',
    });
  });

  it('suggests the entry one character away, when only one is', () => {
    expect(checkNumber('104234', list)).toEqual({
      status: 'near',
      suggestion: '104233',
      why: 'one-character',
    });
  });

  it('suggests nothing when two entries are equally close', () => {
    const pair = buildKnownList([['50621'], ['50628']], { invoiceColumn: 0, hasHeader: false });
    // One character from each, so there is no telling which was meant.
    expect(checkNumber('50626', pair)).toEqual({ status: 'unknown' });
  });

  it('calls a number nothing like any entry unknown', () => {
    expect(checkNumber('999999', list)).toEqual({ status: 'unknown' });
  });

  it('keeps one entry per number, with its client', () => {
    expect(list.entries).toHaveLength(5);
    expect(list.byValue.get('104233')).toEqual({ value: '104233', client: 'Lakeshore', po: '' });
  });
});

describe('the comparisons underneath', () => {
  it('folds look-alike letters into digits', () => {
    expect(lookAlikeKey('SO-8O1B5')).toBe('50-80185');
  });

  it('knows one edit from two', () => {
    expect(oneEditApart('104233', '104234')).toBe(true);
    expect(oneEditApart('104233', '1042333')).toBe(true);
    expect(oneEditApart('104233', '10423')).toBe(true);
    expect(oneEditApart('104233', '104243')).toBe(true);
    expect(oneEditApart('104233', '204234')).toBe(false);
    expect(oneEditApart('104233', '104233')).toBe(false);
  });
});
