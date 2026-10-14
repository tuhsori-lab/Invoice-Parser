import { describe, expect, it } from 'vitest';
import { readFields } from '../../src/core/fields.js';
import { learnLabel, withLabel } from '../../src/core/learn.js';

const page = (...lines) => ({ text: lines.join('\n') });

describe('learning where a value is printed', () => {
  it('learns the label before it, beside it or above it', () => {
    expect(learnLabel([page('Buyer Ref: BR-1001')], 'po', 'BR-1001')).toBe('Buyer Ref');
    expect(learnLabel([page('Cust Order', 'PX-55')], 'po', 'PX-55')).toBe('Cust Order');
    expect(learnLabel([page('Sum payable  $812.40')], 'total', '812.40')).toBe('Sum payable');
    expect(learnLabel([page('Balance owing USD 812.40')], 'total', '$812.40')).toBe(
      'Balance owing'
    );
  });

  it('finds the value however it was typed', () => {
    expect(learnLabel([page('Buyer Ref: PO-1001')], 'po', '1001')).toBe('Buyer Ref');
    expect(learnLabel([page('Sum payable: €1.297,48')], 'total', '1297.48')).toBe('Sum payable');
  });

  it('learns nothing when the value is not there, or has no label', () => {
    expect(learnLabel([page('Buyer Ref: BR-1001')], 'po', 'BR-2002')).toBeNull();
    expect(learnLabel([page('BR-1001')], 'po', 'BR-1001')).toBeNull();
    expect(learnLabel([page('Qty 3  Price 12.00')], 'total', '99.00')).toBeNull();
  });

  it('reads the rest of a batch with what it learned, and only when nothing else worked', () => {
    const learned = { po: ['Buyer Ref'], total: ['Sum payable'] };
    const other = readFields([page('Buyer Ref: BR-1002', 'Sum payable: $75.50')], learned);
    expect(other.po).toMatchObject({ value: 'BR-1002', learned: 'Buyer Ref' });
    expect(other.total).toMatchObject({ amount: 75.5, learned: 'Sum payable' });
    // A usual label still wins.
    const usual = readFields([page('PO Number: PO-7', 'Buyer Ref: BR-9')], learned);
    expect(usual.po.value).toBe('PO-7');
    expect(usual.po.learned).toBeUndefined();
  });

  it('does not learn the same label twice', () => {
    const once = withLabel({ po: [] }, 'po', 'Buyer Ref');
    expect(withLabel(once, 'po', 'BUYER REF')).toBe(once);
  });
});

describe('the shape of a customer’s POs', async () => {
  const { describePattern, findByPattern, poPattern, withPatternPo, withPoPattern } =
    await import('../../src/core/learn.js');

  it('keeps letters and marks, and counts the digits', () => {
    expect(describePattern(poPattern('BR-1001'))).toBe('BR-####');
    expect(describePattern(poPattern('PO 55103388'))).toBe('PO ########');
    expect(describePattern(poPattern('AF/2026/0711'))).toBe('AF/####/####');
    expect(poPattern('no digits')).toBeNull();
  });

  it('finds the one value with that shape, never the invoice number, never a guess between two', () => {
    const shape = [poPattern('4500118')];
    expect(
      findByPattern([page('Invoice 7730415', 'Ref 4500119')], shape, ['7730415'])
    ).toMatchObject({
      value: '4500119',
    });
    expect(findByPattern([page('Ref 4500119 or 4500120')], shape)).toBeNull();
    expect(findByPattern([page('Nothing like it')], shape)).toBeNull();
  });

  it('fills a PO only for the customer it was learned from', () => {
    const learned = withPoPattern({ po: [], total: [] }, 'Atlas Fitness Ltd', 'AF/2026/0711');
    const pages = [page('AF/2026/0712')];
    expect(
      withPatternPo({ customer: 'ATLAS FITNESS LTD.', po: null }, pages, learned, 'SM-2').po
    ).toMatchObject({
      value: 'AF/2026/0712',
      pattern: 'Atlas Fitness Ltd',
    });
    expect(
      withPatternPo({ customer: 'Pinecrest', po: null }, pages, learned, 'SM-3').po
    ).toBeNull();
    // A PO a label found is never second-guessed.
    expect(
      withPatternPo({ customer: 'Atlas Fitness Ltd', po: { value: 'X-1' } }, pages, learned, 'SM-4')
        .po.value
    ).toBe('X-1');
  });

  it('never takes a date above a value for its label', () => {
    expect(learnLabel([page('Date: Oct 1, 2026', 'BR-1001')], 'po', 'BR-1001')).toBeNull();
  });
});

describe('what is never a label', () => {
  it('does not take the customer’s name above a PO for its label', () => {
    const pages = [page('Bill to:', 'Atlas Fitness Ltd', 'AF/2026/0711')];
    expect(learnLabel(pages, 'po', 'AF/2026/0711', ['Atlas Fitness Ltd'])).toBeNull();
  });
});

describe('changing a typed PO', async () => {
  const { withPoPattern, withoutPoPattern, describePattern } =
    await import('../../src/core/learn.js');
  const { guessFieldColumns } = await import('../../src/core/reconcile/sheet.js');

  it('forgets the shape the first, mistyped, spelling taught', () => {
    const slip = withPoPattern({ po: [], total: [] }, 'Greenfield Farms', 'GF-2011');
    const fixed = withPoPattern(
      withoutPoPattern(slip, 'Greenfield Farms', 'GF-2011'),
      'Greenfield Farms',
      'GF-20113'
    );
    const patterns = Object.values(fixed.poPatterns)[0].patterns.map(describePattern);
    expect(patterns).toEqual(['GF-#####']);
  });

  it('reads CustName as the customer column', () => {
    expect(guessFieldColumns(['InvNo', 'CustName', 'InvAmnt'], 0)).toMatchObject({
      customer: 1,
      amount: 2,
    });
  });
});
