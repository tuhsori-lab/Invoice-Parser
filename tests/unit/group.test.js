/**
 * Which pages belong to which invoice.
 *
 * These tests use pages built by hand rather than real PDFs, so each rule can
 * be checked on its own. The same rules are checked against the sample PDFs in
 * fixtures.test.js.
 */

import { describe, expect, it } from 'vitest';
import {
  FLAG_LABELS,
  groupPages,
  groupsNeedingReview,
  pageNumbersOf,
} from '../../src/core/group.js';

/** One analysed page: a number, or nothing, plus whatever else matters. */
function page(index, value, extras = {}) {
  return {
    index,
    fileId: 'batch.pdf',
    fileName: 'batch.pdf',
    filePageIndex: index - 1,
    text: extras.text ?? (value ? `Invoice #: ${value}` : 'Continued'),
    hasText: true,
    detection: value ? { value, label: 'Invoice #:', source: 'common' } : null,
    candidates: [],
    conflict: false,
    extra: null,
    client: '',
    matchedProfiles: [],
    ...extras,
  };
}

const numbers = (groups) => groups.map((group) => group.invoice);
const layout = (groups) => groups.map(pageNumbersOf);

describe('splitting by invoice number', () => {
  it('keeps pages that share a number together', () => {
    const groups = groupPages([page(1, '100777'), page(2, '100777'), page(3, '100888')]);

    expect(layout(groups)).toEqual([[1, 2], [3]]);
    expect(numbers(groups)).toEqual(['100777', '100888']);
  });

  it('adds a page with no number to the invoice before it', () => {
    const groups = groupPages([page(1, '104233'), page(2, null)], { unnumbered: 'attach' });

    expect(layout(groups)).toEqual([[1, 2]]);
    expect(groups[0].continuationPages, 'shown as a continuation page').toEqual([2]);
    expect(groups[0].flags).toEqual([]);
  });

  it('sets pages with no number aside when asked to', () => {
    const groups = groupPages(
      [page(1, '104233'), page(2, null), page(3, null), page(4, '104777')],
      {
        unnumbered: 'review',
      }
    );

    expect(layout(groups)).toEqual([[1], [2, 3], [4]]);
    expect(groups[1].flags).toEqual(['no-number']);
  });

  it('starts a group for pages that come before any number at all', () => {
    const groups = groupPages([page(1, null), page(2, '104233')]);

    expect(layout(groups)).toEqual([[1], [2]]);
    expect(groups[0].flags).toEqual(['no-number']);
    expect(groups[0].continuationPages, 'the first page continues nothing').toEqual([]);
  });

  it('can put pages that share a number together even when they are apart', () => {
    const pages = [page(1, 'INV-2001'), page(2, 'INV-2002'), page(3, 'INV-2001')];

    expect(layout(groupPages(pages))).toEqual([[1], [2], [3]]);
    expect(layout(groupPages(pages, { combinePages: true }))).toEqual([[1, 3], [2]]);
  });
});

describe('splitting on a marker', () => {
  it('starts a new invoice wherever the marker appears', () => {
    const pages = [
      page(1, null, { text: 'Page 1 of 2' }),
      page(2, null, { text: 'Page 2 of 2' }),
      page(3, null, { text: 'Page 1 of 3' }),
      page(4, null, { text: 'Page 2 of 3' }),
    ];

    const groups = groupPages(pages, { mode: 'by-marker', markerText: 'Page 1 of' });

    expect(layout(groups)).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it('does not mind how the marker is spaced or capitalised', () => {
    const pages = [page(1, null, { text: 'PAGE  1  OF  2' }), page(2, null, { text: 'other' })];

    expect(layout(groupPages(pages, { mode: 'by-marker', markerText: 'page 1 of' }))).toEqual([
      [1, 2],
    ]);
  });
});

describe('splitting every N pages', () => {
  it('cuts the batch into runs of the size asked for', () => {
    const pages = [1, 2, 3, 4, 5].map((index) => page(index, null));

    expect(layout(groupPages(pages, { mode: 'every-n', pagesPerInvoice: 2 }))).toEqual([
      [1, 2],
      [3, 4],
      [5],
    ]);
  });

  it('treats a size below one as one page per invoice', () => {
    const pages = [page(1, null), page(2, null)];

    expect(layout(groupPages(pages, { mode: 'every-n', pagesPerInvoice: 0 }))).toEqual([[1], [2]]);
  });
});

describe('review flags', () => {
  it('flags an invoice with no number', () => {
    const [group] = groupPages([page(1, null)]);

    expect(group.flags).toEqual(['no-number']);
  });

  it('flags a number that came from the bare "Invoice" tier', () => {
    const [group] = groupPages([
      page(1, '445566', { detection: { value: '445566', label: 'INVOICE', source: 'bare' } }),
    ]);

    expect(group.flags).toEqual(['fallback']);
  });

  it('flags a page that offered two different numbers', () => {
    const [group] = groupPages([page(1, '1111', { conflict: true })]);

    expect(group.flags).toEqual(['conflict']);
  });

  it('flags text that came from a scan', () => {
    const [group] = groupPages([page(1, '552211', { ocr: true })]);

    expect(group.flags).toEqual(['ocr']);
  });

  it('lists only the invoices that need looking at', () => {
    const groups = groupPages([page(1, '104233'), page(2, null)], { unnumbered: 'review' });

    expect(groupsNeedingReview(groups)).toHaveLength(1);
  });

  it('has plain words for every flag it can raise', () => {
    const raised = new Set(
      groupPages([page(1, null), page(2, '1', { conflict: true, ocr: true })]).flatMap(
        (group) => group.flags
      )
    );

    for (const flag of raised) expect(FLAG_LABELS[flag]).toBeTruthy();
  });
});

describe('fixes made by hand', () => {
  it('splits where the user asked, even though the number is the same', () => {
    const pages = [page(1, '100777'), page(2, '100777'), page(3, '100777')];

    const groups = groupPages(pages, { overrides: { boundaries: { 3: 'split' } } });

    expect(layout(groups)).toEqual([[1, 2], [3]]);
  });

  it('joins where the user asked, even though the numbers differ', () => {
    const pages = [page(1, '100777'), page(2, '100888')];

    const groups = groupPages(pages, { overrides: { boundaries: { 2: 'join' } } });

    expect(layout(groups)).toEqual([[1, 2]]);
    expect(groups[0].invoice, 'the first number found still names the invoice').toBe('100777');
  });

  it('keeps a number the user typed, and says it came from them', () => {
    const groups = groupPages([page(1, null), page(2, null)], {
      unnumbered: 'review',
      overrides: { numbers: { g1: '104233' } },
    });

    expect(groups[0].invoice).toBe('104233');
    expect(groups[0].manual).toBe(true);
    expect(groups[0].provenance).toEqual({
      label: 'typed by you',
      source: 'manual',
      pageIndex: null,
    });
    expect(groups[0].flags, 'no longer needs review').toEqual([]);
  });

  it('gives a group the same id whatever the settings are, so a fix survives', () => {
    const pages = [page(1, '100777'), page(2, null), page(3, '100888')];

    const attached = groupPages(pages, { unnumbered: 'attach' });
    const setAside = groupPages(pages, { unnumbered: 'review' });

    expect(attached[0].id).toBe('g1');
    expect(setAside[0].id).toBe('g1');
    expect(setAside.at(-1).id).toBe('g3');
  });
});

describe('nothing to group', () => {
  it('gives back no invoices for no pages', () => {
    expect(groupPages([])).toEqual([]);
    expect(groupPages()).toEqual([]);
  });
});
