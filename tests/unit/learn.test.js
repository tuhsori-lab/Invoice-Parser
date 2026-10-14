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
