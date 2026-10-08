/**
 * Counting how each client's invoices went.
 */

import { describe, expect, it } from 'vitest';
import { OTHER_CLIENT, addToTally, outcomeOf, tallyRows } from '../../src/core/tally.js';

const invoice = (clientKey, extra = {}) => ({ clientKey, flags: [], provenance: {}, ...extra });

describe('what became of an invoice', () => {
  it('is accepted when nothing was flagged or changed', () => {
    expect(outcomeOf(invoice('box-1'))).toBe('accepted');
  });

  it('is corrected when a person typed the number, or the list put it right', () => {
    expect(outcomeOf(invoice('box-1', { provenance: { source: 'manual' } }))).toBe('corrected');
    expect(outcomeOf(invoice('box-1', { correctedFrom: 'S0-80155' }))).toBe('corrected');
  });

  it('was sent to review when it went out with something flagged', () => {
    expect(outcomeOf(invoice('box-1', { flags: ['ocr'] }))).toBe('review');
  });
});

describe('the tally', () => {
  const names = { 'box-1': 'Hollowpine Joinery', 'box-2': 'Quillfeather Paper Co.' };
  const nameOf = (key) => names[key];

  it('counts each client under its own name', () => {
    const tally = addToTally(
      {},
      [
        invoice('box-1'),
        invoice('box-1', { flags: ['conflict'] }),
        invoice('box-2', { provenance: { source: 'manual' } }),
      ],
      nameOf
    );
    expect(tally).toEqual({
      'box-1': { name: 'Hollowpine Joinery', accepted: 1, corrected: 0, review: 1 },
      'box-2': { name: 'Quillfeather Paper Co.', accepted: 0, corrected: 1, review: 0 },
    });
  });

  it('adds to what was there, without changing it', () => {
    const before = {
      'box-1': { name: 'Hollowpine Joinery', accepted: 4, corrected: 1, review: 2 },
    };
    const after = addToTally(before, [invoice('box-1')], nameOf);
    expect(after['box-1'].accepted).toBe(5);
    expect(before['box-1'].accepted).toBe(4);
  });

  it('counts invoices found without a box together', () => {
    const tally = addToTally({}, [invoice('file:batch.pdf'), invoice(undefined)], nameOf);
    expect(tally).toEqual({ other: { name: OTHER_CLIENT, accepted: 2, corrected: 0, review: 0 } });
  });

  it('keeps a client name it already had when the box has since been forgotten', () => {
    const before = {
      'box-9': { name: 'Larchmont Printing', accepted: 1, corrected: 0, review: 0 },
    };
    expect(addToTally(before, [invoice('box-9')], nameOf)['box-9'].name).toBe('Larchmont Printing');
  });

  it('lists the busiest client first, and invoices without a box last', () => {
    const rows = tallyRows({
      other: { name: OTHER_CLIENT, accepted: 50, corrected: 0, review: 0 },
      'box-1': { name: 'Hollowpine Joinery', accepted: 1, corrected: 0, review: 0 },
      'box-2': { name: 'Quillfeather Paper Co.', accepted: 3, corrected: 1, review: 1 },
    });
    expect(rows.map((row) => [row.name, row.total])).toEqual([
      ['Quillfeather Paper Co.', 5],
      ['Hollowpine Joinery', 1],
      [OTHER_CLIENT, 50],
    ]);
  });
});
