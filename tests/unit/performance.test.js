/**
 * Staying quick on a batch nobody would call small.
 *
 * The promise is that a thousand-page batch stays responsive. Reading the PDF
 * is slow and only happens once; what happens over and over is this pipeline -
 * detect, group, name - because it re-runs every time somebody changes a
 * setting or fixes something by hand. If that is fast, the app feels fast.
 *
 * The budgets below are deliberately loose. They are here to catch a change
 * that makes the pipeline ten times slower, not to measure a machine.
 */

import { describe, expect, it } from 'vitest';
import { analyzePages } from '../../src/core/analyze.js';
import { groupPages } from '../../src/core/group.js';
import { assignFileNames } from '../../src/core/naming.js';
import { reviewQueue } from '../../src/core/review.js';
import { createProfile } from '../../src/core/profiles.js';

/** A batch of the given size, shaped like a real one: mostly two-page invoices. */
function batchOf(pageCount) {
  return Array.from({ length: pageCount }, (unused, position) => {
    const index = position + 1;
    const invoice = 100_000 + Math.floor(position / 2);
    const secondSheet = position % 2 === 1;
    return {
      index,
      fileId: 'batch.pdf',
      fileName: 'batch.pdf',
      filePageIndex: position,
      pageNumberInFile: index,
      hasText: true,
      ocr: false,
      text: secondSheet
        ? `Northwind Traders\n4100 Harbour Way, Portland, OR 97203\nDelivery notes\nSheet 2 of 2\nGoods left at the loading bay.`
        : `Northwind Traders\n4100 Harbour Way, Portland, OR 97203\nInvoice #: ${invoice}\nInvoice Date: 04/09/2026\nPO #: PO-${invoice}\nDescription Qty Unit Amount\nBlue crate, 40 L 12 18.00 216.00`,
    };
  });
}

/** How long one run of the whole pipeline takes, in milliseconds. */
function timePipeline(pages, settings = {}) {
  const started = performance.now();
  const analyzed = analyzePages(pages, { extraLabel: 'PO #', ...settings });
  const groups = assignFileNames(groupPages(analyzed, {}));
  reviewQueue(groups);
  return { ms: performance.now() - started, groups };
}

describe('a thousand pages', () => {
  const pages = batchOf(1000);

  it('splits into the invoices it should', () => {
    const { groups } = timePipeline(pages);

    expect(groups).toHaveLength(500);
    expect(groups[0].pages.map((page) => page.index)).toEqual([1, 2]);
    expect(groups[0].invoice).toBe('100000');
    expect(groups[0].extra?.value).toBe('PO-100000');
  });

  it('re-runs detection, grouping and naming well inside a frame budget', () => {
    // Warm up, so the first run's compilation is not what is being measured.
    timePipeline(pages);

    const runs = [timePipeline(pages).ms, timePipeline(pages).ms, timePipeline(pages).ms];
    const best = Math.min(...runs);

    expect(best, `pipeline took ${runs.map((ms) => ms.toFixed(0)).join(', ')} ms`).toBeLessThan(
      1500
    );
  });

  it('stays quick with client profiles switched on', () => {
    const profiles = [
      createProfile({
        name: 'Northwind Traders',
        labels: ['Our Ref'],
        identifyingText: ['Northwind Traders'],
      }),
      createProfile({
        name: 'Contoso Supply Co.',
        labels: ['Statement Ref'],
        identifyingText: ['Contoso'],
      }),
    ];

    timePipeline(pages, { profiles });
    const { ms } = timePipeline(pages, { profiles });

    expect(ms, `pipeline with profiles took ${ms.toFixed(0)} ms`).toBeLessThan(2500);
  });

  it('keeps every fix made by hand without slowing down', () => {
    const boundaries = {};
    const numbers = {};
    for (let page = 3; page <= 1000; page += 50) boundaries[page] = 'split';
    for (let page = 1; page <= 1000; page += 100) numbers[`g${page}`] = `TYPED-${page}`;

    const analyzed = analyzePages(pages, {});
    const started = performance.now();
    const groups = assignFileNames(groupPages(analyzed, { overrides: { boundaries, numbers } }));
    const ms = performance.now() - started;

    expect(groups.some((group) => group.invoice === 'TYPED-1')).toBe(true);
    expect(ms, `grouping with fixes took ${ms.toFixed(0)} ms`).toBeLessThan(500);
  });
});
