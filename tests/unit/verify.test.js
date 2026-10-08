/**
 * The checks every invoice goes through before it can be exported without a
 * second look. Every number and name here is invented.
 */

import { describe, expect, it } from 'vitest';
import { groupPages } from '../../src/core/group.js';
import { buildKnownList } from '../../src/core/knownList.js';
import { reviewReason } from '../../src/core/review.js';
import { createProfile } from '../../src/core/profiles.js';
import {
  describeShape,
  isBlankPage,
  learnShape,
  lookAlikeSwaps,
  verifyGroups,
} from '../../src/core/verify.js';

/** A page as analyze.js leaves it, with only what these checks look at. */
function page(index, value, extra = {}) {
  const detection = value
    ? { value, label: 'Invoice No:', source: 'common', ...(extra.detection ?? {}) }
    : null;
  return {
    index,
    fileName: 'batch.pdf',
    text: extra.text ?? (value ? `Invoice No: ${value} page ${index}` : `continued ${index}`),
    detection,
    candidates: extra.candidates ?? (detection ? [detection] : []),
    conflict: extra.conflict ?? false,
    agreement: extra.agreement ?? false,
    matchedProfiles: extra.matchedProfiles ?? [],
    pageOf: extra.pageOf ?? null,
    ocr: extra.ocr ?? false,
    hasText: true,
  };
}

const listOf = (...values) =>
  buildKnownList(
    values.map((value) => [value]),
    { invoiceColumn: 0, hasHeader: false },
    'open-invoices.csv'
  );

const flagsOf = (result) => result.groups.map((group) => group.flags);

describe('the invoice list', () => {
  const pages = [page(1, '104233'), page(2, 'S0-80155'), page(3, '777001')];

  it('verifies what is in it, suggests what is nearly in it, and flags the rest', () => {
    const { groups } = verifyGroups(groupPages(pages), {
      knownList: listOf('104233', 'SO-80155'),
    });
    expect(groups[0]).toMatchObject({ verified: true, flags: [] });
    expect(groups[1].flags).toEqual(['near-list']);
    expect(groups[1].suggestion).toEqual({ value: 'SO-80155', why: 'look-alike' });
    expect(groups[1].invoice, 'a suggestion is never put in by itself').toBe('S0-80155');
    expect(groups[2].flags).toEqual(['not-in-list']);
  });

  it('only notes a number missing from the list when strict mode is off', () => {
    const { groups } = verifyGroups(groupPages([page(1, '777001')]), {
      knownList: listOf('104233'),
      strict: false,
    });
    expect(groups[0]).toMatchObject({ flags: [], notInList: true });
  });

  it('lists the invoices it expected and did not find', () => {
    const { missing } = verifyGroups(groupPages([page(1, '104233')]), {
      knownList: listOf('104233', '104301'),
    });
    expect(missing).toEqual([{ value: '104301', client: '' }]);
  });

  it('does not count as missing a number it is offering for one that is here', () => {
    const { missing } = verifyGroups(groupPages([page(1, 'S0-80155')]), {
      knownList: listOf('SO-80155', '104301'),
    });
    expect(missing.map((entry) => entry.value)).toEqual(['104301']);
  });

  it('says it in plain words, naming the pages', () => {
    const { groups } = verifyGroups(groupPages(pages), { knownList: listOf('SO-80155') });
    expect(reviewReason('near-list', groups[1])).toBe(
      'S0-80155 on page 2 is not in your invoice list, but SO-80155 is - they differ only by letters and digits that look alike.'
    );
    expect(reviewReason('not-in-list', groups[2])).toBe(
      '777001 on page 3 is not in your invoice list.'
    );
  });
});

describe('a number read from a scan', () => {
  const scanned = (extra) => page(1, '664120', { ocr: true, ...extra });

  it('goes through without review when it was read surely and something backs it up', () => {
    const { groups } = verifyGroups(
      groupPages([scanned({ detection: { confidence: 91 }, agreement: true })])
    );
    expect(groups[0].flags).toEqual([]);
  });

  it('is flagged when only one reading found it', () => {
    const { groups } = verifyGroups(groupPages([scanned({ detection: { confidence: 91 } })]));
    expect(groups[0].flags).toEqual(['ocr']);
    expect(reviewReason('ocr', groups[0])).toBe(
      '664120 was read from a scan on page 1, and nothing else on the page backs it up. Check it against the page.'
    );
  });

  it('is flagged, with how sure it was, when it was read unsurely', () => {
    const { groups } = verifyGroups(
      groupPages([scanned({ detection: { confidence: 52 }, agreement: true })])
    );
    expect(reviewReason('ocr', groups[0])).toBe(
      '664120 was read from a scan on page 1, and the app was only 52% sure of it.'
    );
  });

  it('counts the same number on two of its pages as backing', () => {
    const { groups } = verifyGroups(
      groupPages([
        scanned({ detection: { confidence: 90 } }),
        page(2, '664120', { ocr: true, detection: { confidence: 88 } }),
      ])
    );
    expect(groups[0].flags).toEqual([]);
  });

  it('goes through when the invoice list has it, however unsure the reading', () => {
    const { groups } = verifyGroups(groupPages([scanned({ detection: { confidence: 40 } })]), {
      knownList: listOf('664120'),
    });
    expect(groups[0].flags).toEqual([]);
  });

  it('goes through once a person has typed the number in', () => {
    const typed = groupPages([scanned({ detection: { confidence: 40 } })], {
      overrides: { numbers: { g1: '664120' } },
    });
    expect(flagsOf(verifyGroups(typed))).toEqual([[]]);
  });
});

describe('two readings of one page', () => {
  it('shows both when the box and a label disagree', () => {
    const box = { value: '50621', label: 'Harbor & Pine', source: 'zone' };
    const label = { value: '50612', label: 'Invoice No:', source: 'common' };
    const { groups } = verifyGroups(
      groupPages([page(1, '50621', { detection: box, candidates: [box, label], conflict: true })])
    );
    expect(groups[0].flags).toEqual(['conflict']);
    expect(reviewReason('conflict', groups[0])).toBe(
      'Page 1 gives two different numbers: 50621 (in the box you drew) and 50612 (after "Invoice No:"). 50621 was used.'
    );
  });
});

describe('"Page X of Y"', () => {
  it('passes pages that are all there, in order', () => {
    const { groups } = verifyGroups(
      groupPages([
        page(1, '552190', { pageOf: { page: 1, of: 2 } }),
        page(2, null, { pageOf: { page: 2, of: 2 } }),
      ])
    );
    expect(groups[0].flags).toEqual([]);
  });

  it('passes an invoice where only some pages are marked, in step with where they sit', () => {
    const { groups } = verifyGroups(
      groupPages([page(1, '552190'), page(2, '552190', { pageOf: { page: 2, of: 2 } })])
    );
    expect(groups[0].flags).toEqual([]);
  });

  it('flags marks that run backwards', () => {
    const { groups } = verifyGroups(
      groupPages([
        page(1, '552190', { pageOf: { page: 2, of: 2 } }),
        page(2, null, { pageOf: { page: 1, of: 2 } }),
      ])
    );
    expect(groups[0].flags).toEqual(['page-order']);
  });

  it('flags an invoice with a page missing', () => {
    const { groups } = verifyGroups(
      groupPages([
        page(1, '552204', { pageOf: { page: 1, of: 3 } }),
        page(2, null, { pageOf: { page: 2, of: 3 } }),
      ])
    );
    expect(groups[0].flags).toEqual(['page-count']);
    expect(reviewReason('page-count', groups[0])).toBe(
      'The pages say this invoice has 3 pages, but 2 are here (pages 1 to 2). A page may be missing, or belong to another invoice.'
    );
  });

  it('flags two invoices run together', () => {
    const { groups } = verifyGroups(
      groupPages([
        page(1, '552204', { pageOf: { page: 1, of: 1 } }),
        page(2, null, { pageOf: { page: 1, of: 1 } }),
      ])
    );
    expect(groups[0].flags).toEqual(['page-order']);
    expect(reviewReason('page-order', groups[0])).toMatch(/^Page 2 says "Page 1 of"/);
  });
});

describe('blank pages, and pages from nobody', () => {
  it('flags a blank page', () => {
    const blank = { ...page(2, null), text: '', ocr: true };
    const { groups } = verifyGroups(groupPages([page(1, '104233'), blank]));
    expect(groups[0].flags).toEqual(['blank-page']);
    expect(reviewReason('blank-page', groups[0])).toBe('Page 2 is blank.');
  });

  it('tells a blank page from one not read yet', () => {
    expect(isBlankPage({ text: '', ocr: false }, () => undefined)).toBe(false);
    expect(isBlankPage({ text: '', ocr: false }, () => false)).toBe(true);
    expect(isBlankPage({ text: '', ocr: false }, () => true)).toBe(false);
  });

  const box = createProfile({
    name: 'Harbor',
    identifyingText: ['Harbor'],
    zone: { x0: 0.1, x1: 0.2, y0: 0.8, y1: 0.9 },
  });

  it('in a batch read from a box, flags a page that matches no client', () => {
    const { groups } = verifyGroups(
      groupPages([page(1, '50621', { matchedProfiles: [box] }), page(2, null)])
    );
    expect(groups[0].flags).toEqual(['no-client']);
    expect(reviewReason('no-client', groups[0])).toBe(
      'Page 2 does not match any client you have drawn a box for. It may belong to another client.'
    );
  });

  it('leaves alone a continuation page that names its invoice in a running header', () => {
    const next = { ...page(2, null), text: 'Orders - 50621 - continued' };
    const { groups } = verifyGroups(
      groupPages([page(1, '50621', { matchedProfiles: [box] }), next])
    );
    expect(groups[0].flags).toEqual([]);
  });

  it('leaves alone a page printed word for word more than once, like terms of sale', () => {
    const terms = (index) => ({ ...page(index, null), text: 'TERMS AND CONDITIONS OF SALE' });
    const { groups } = verifyGroups(
      groupPages([
        page(1, '50621', { matchedProfiles: [box] }),
        terms(2),
        page(3, '50698', { matchedProfiles: [box] }),
        terms(4),
      ])
    );
    expect(flagsOf({ groups })).toEqual([[], []]);
  });

  it('asks nothing of a batch nobody has drawn a box for', () => {
    expect(flagsOf(verifyGroups(groupPages([page(1, '104233'), page(2, null)])))).toEqual([[]]);
  });
});

describe("a client's own kind of number", () => {
  const box = createProfile({
    name: 'Osbourne',
    identifyingText: ['Osbourne'],
    zone: { x0: 0.1, x1: 0.2, y0: 0.8, y1: 0.9 },
    zoneShape: 'A2 - D5',
  });
  const theirs = (index, value) => page(index, value, { matchedProfiles: [box] });

  it('flags a number of the wrong shape, and offers the one look-alike swap that fits', () => {
    const { groups } = verifyGroups(groupPages([theirs(1, 'S0-80155')]));
    expect(groups[0].flags).toEqual(['odd-shape']);
    expect(groups[0].suggestion).toEqual({ value: 'SO-80155', why: 'shape' });
    expect(reviewReason('odd-shape', groups[0])).toBe(
      "S0-80155 on page 1 does not look like this client's other numbers, which are 2 letters, a hyphen, then 5 digits. SO-80155 would fit."
    );
  });

  it('puts it right only when the invoice list confirms the swap, and says so', () => {
    const { groups } = verifyGroups(groupPages([theirs(1, 'S0-80155')]), {
      knownList: listOf('SO-80155'),
    });
    expect(groups[0]).toMatchObject({
      invoice: 'SO-80155',
      correctedFrom: 'S0-80155',
      verified: true,
      flags: [],
    });
  });

  it('learns a shape and a shared prefix from numbers known to be right', () => {
    expect(learnShape(['INV-30117', 'INV-30125'])).toEqual({ shapes: ['A3 - D5'], prefix: 'INV-' });
    expect(learnShape(['718840'])).toEqual({ shapes: ['D6'], prefix: '' });
  });

  it('uses a shape learned in an earlier batch', () => {
    const plain = createProfile({ ...box, zoneShape: '' });
    const { groups } = verifyGroups(groupPages([page(1, '71884O', { matchedProfiles: [plain] })]), {
      learned: { [plain.id]: { shapes: ['D6'], prefix: '' } },
    });
    expect(groups[0].flags).toEqual(['odd-shape']);
    expect(groups[0].suggestion?.value).toBe('718840');
  });
});

describe('numbers far out of sequence', () => {
  it("flags a number far from the client's others in the batch", () => {
    const { groups } = verifyGroups(
      groupPages([page(1, '664120'), page(2, '664127'), page(3, '864127'), page(4, '664133')])
    );
    expect(flagsOf({ groups })).toEqual([[], [], ['out-of-sequence'], []]);
    expect(reviewReason('out-of-sequence', groups[2])).toBe(
      "864127 on page 3 is far from this client's other numbers in this batch (664120 to 664133)."
    );
  });

  it('leaves an ordinary run of numbers alone', () => {
    const { groups } = verifyGroups(
      groupPages([page(1, '50621'), page(2, '50698'), page(3, '50702')])
    );
    expect(flagsOf({ groups })).toEqual([[], [], []]);
  });
});

describe('the small pieces', () => {
  it('lists every one-character look-alike swap', () => {
    expect(lookAlikeSwaps('S0-1')).toEqual(['50-1', 'SO-1', 'S0-I', 'S0-L']);
  });

  it('describes a shape in words', () => {
    expect(describeShape('D5')).toBe('5 digits');
    expect(describeShape('A2 - D5')).toBe('2 letters, a hyphen, then 5 digits');
    expect(describeShape('D8 _ D1')).toBe('8 digits, an underscore, then 1 digit');
  });
});
