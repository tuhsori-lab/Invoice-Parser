/**
 * The words shown to a person when something needs checking.
 *
 * These are product copy as much as code: every reason has to name the pages
 * and read as a sentence, because that is what makes a queue of problems
 * something a person can work through rather than a wall of jargon.
 */

import { describe, expect, it } from 'vitest';
import { describePages, exportWarning, reviewQueue, reviewReason } from '../../src/core/review.js';
import { FLAG_LABELS } from '../../src/core/group.js';

/** A finished invoice, as the rest of the engine hands it over. */
function group(overrides = {}) {
  const pageNumbers = overrides.pageNumbers ?? [5, 6];
  return {
    id: `g${pageNumbers[0]}`,
    invoice: '104233',
    fileName: '104233.pdf',
    flags: [],
    pages: pageNumbers.map((index) => ({ index })),
    ...overrides,
  };
}

describe('naming the pages', () => {
  it('uses the singular for one page', () => {
    expect(describePages(group({ pageNumbers: [5] }))).toBe('page 5');
  });

  it('writes a run the long way, as the CSV does', () => {
    expect(describePages(group({ pageNumbers: [5, 6] }))).toBe('pages 5 to 6');
  });

  it('copes with pages that are not next to each other', () => {
    expect(describePages(group({ pageNumbers: [5, 6, 9] }))).toBe('pages 5 to 6, 9');
  });
});

describe('the reason for each problem', () => {
  it('says where a missing number was missing from', () => {
    expect(reviewReason('no-number', group({ invoice: null }))).toBe(
      'No invoice number was found on pages 5 to 6.'
    );
  });

  it('says which number won when two were found', () => {
    expect(reviewReason('conflict', group({ invoice: '1111' }))).toBe(
      'Two different invoice numbers appear on pages 5 to 6. 1111 was used.'
    );
  });

  it('says what each invoice in a name clash is actually saved as', () => {
    // Only the second of a pair gets a new name, so the sentence has to be true
    // of the first one as well.
    expect(reviewReason('duplicate-name', group({ fileName: '104233.pdf' }))).toBe(
      'Another invoice has the same number. This one is saved as 104233.pdf.'
    );
    expect(reviewReason('duplicate-name', group({ fileName: '104233 (2).pdf' }))).toContain(
      'saved as 104233 (2).pdf'
    );
  });

  it('explains a number that came from the word "Invoice" alone', () => {
    expect(reviewReason('fallback', group({ invoice: '445566' }))).toContain(
      'came from the word "Invoice" on its own'
    );
  });

  it('warns that text read from a scan may be wrong', () => {
    expect(reviewReason('ocr', group())).toContain('read from a scan');
  });

  it('has a sentence for every flag the engine can raise', () => {
    for (const flag of Object.keys(FLAG_LABELS)) {
      const sentence = reviewReason(flag, group({ invoice: '1', fileName: 'a.pdf' }));
      expect(sentence, `${flag} reads as a sentence`).toMatch(/^[A-Z0-9].*[.?]$/);
      expect(sentence, `${flag} avoids jargon`).not.toMatch(/flag|null|undefined/i);
    }
  });
});

describe('the queue', () => {
  it('lists only the invoices with something wrong, in page order', () => {
    const queue = reviewQueue([
      group({ pageNumbers: [1], flags: [] }),
      group({ pageNumbers: [2], flags: ['no-number'], invoice: null }),
      group({ pageNumbers: [3], flags: ['ocr'] }),
    ]);

    expect(queue.map((item) => item.id)).toEqual(['g2', 'g3']);
  });

  it('leads with the worst problem when an invoice has several', () => {
    const [item] = reviewQueue([group({ flags: ['ocr', 'no-number'], invoice: null })]);

    expect(item.flag).toBe('no-number');
    expect(item.reasons).toHaveLength(2);
    expect(item.reasons[0]).toContain('No invoice number');
  });

  it('gives back nothing when there is nothing to do', () => {
    expect(reviewQueue([group()])).toEqual([]);
    expect(reviewQueue()).toEqual([]);
  });
});

describe('the warning before exporting', () => {
  it('counts in plain language', () => {
    expect(exportWarning(1)).toBe('1 invoice still needs a look. Export anyway?');
    expect(exportWarning(4)).toBe('4 invoices still need a look. Export anyway?');
  });
});
