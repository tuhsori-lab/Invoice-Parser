/**
 * The files that come out: one PDF per invoice, and a ZIP of all of them.
 *
 * The PDFs here are the real sample files, opened with pdf-lib the way the app
 * does, so a page count in a test is a page count in a finished file.
 */

import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import { buildAllInvoicePdfs, buildInvoicePdf, buildZip } from '../../src/core/export.js';
import { readFixture } from '../helpers/loadFixture.js';

/** Load the sample PDFs the app would keep in memory for export. */
async function openSources(names) {
  const sources = new Map();
  for (const name of names) sources.set(name, await PDFDocument.load(await readFixture(name)));
  return sources;
}

/** A group whose pages point into one or more sample files. */
function group(invoice, pages, extras = {}) {
  return {
    invoice,
    pages: pages.map(([fileId, filePageIndex], position) => ({
      index: position + 1,
      fileId,
      fileName: fileId,
      filePageIndex,
    })),
    extra: null,
    provenance: { label: 'Invoice #:', source: 'common' },
    flags: [],
    ...extras,
  };
}

describe('one invoice, one PDF', () => {
  it('copies just the pages of that invoice', async () => {
    const sources = await openSources(['03-repeated-number.pdf']);
    const bytes = await buildInvoicePdf(
      group('100777', [
        ['03-repeated-number.pdf', 0],
        ['03-repeated-number.pdf', 1],
      ]),
      sources
    );

    const out = await PDFDocument.load(bytes);
    expect(out.getPageCount()).toBe(2);
  });

  it('works when an invoice runs across two source files', async () => {
    const sources = await openSources(['01-same-line.pdf', '03-repeated-number.pdf']);
    const bytes = await buildInvoicePdf(
      group('104233', [
        ['01-same-line.pdf', 0],
        ['03-repeated-number.pdf', 2],
        ['01-same-line.pdf', 1],
      ]),
      sources
    );

    const out = await PDFDocument.load(bytes);
    expect(out.getPageCount()).toBe(3);
  });

  it('says which file is missing rather than failing silently', async () => {
    await expect(buildInvoicePdf(group('104233', [['gone.pdf', 0]]), new Map())).rejects.toThrow(
      /no longer open/i
    );
  });

  it('builds every invoice in the batch and reports progress', async () => {
    const sources = await openSources(['05-repeat-later.pdf']);
    const groups = [
      { ...group('INV-2001', [['05-repeat-later.pdf', 0]]), fileName: 'INV-2001.pdf' },
      { ...group('INV-2002', [['05-repeat-later.pdf', 1]]), fileName: 'INV-2002.pdf' },
    ];
    const seen = [];

    const files = await buildAllInvoicePdfs(groups, sources, {
      onProgress: (done, total) => seen.push(`${done}/${total}`),
    });

    expect(files.map((file) => file.name)).toEqual(['INV-2001.pdf', 'INV-2002.pdf']);
    expect(seen).toEqual(['1/2', '2/2']);
  });

  it('stops when the user cancels', async () => {
    const sources = await openSources(['05-repeat-later.pdf']);
    const signal = { aborted: true };
    const groups = [{ ...group('INV-2001', [['05-repeat-later.pdf', 0]]), fileName: 'a.pdf' }];

    expect(await buildAllInvoicePdfs(groups, sources, { signal })).toEqual([]);
  });
});

describe('the ZIP', () => {
  it('holds every invoice under its own name', async () => {
    const files = [
      { name: 'INV-2001.pdf', data: new Uint8Array([1, 2, 3]) },
      { name: 'INV-2002.pdf', data: new Uint8Array([4, 5, 6]) },
    ];

    const zip = await JSZip.loadAsync(await buildZip(files, { type: 'uint8array' }));

    expect(Object.keys(zip.files).sort()).toEqual(['INV-2001.pdf', 'INV-2002.pdf']);
    expect(await zip.file('INV-2002.pdf').async('uint8array')).toEqual(new Uint8Array([4, 5, 6]));
  });

  it('stores the PDFs rather than compressing them again', async () => {
    // A PDF is already compressed, so the bytes should come through untouched.
    // Method 0 in the ZIP header means "stored".
    const data = new Uint8Array(2048).fill(7);
    const zipped = await buildZip([{ name: 'big.pdf', data }], { type: 'uint8array' });

    const method = zipped[8] | (zipped[9] << 8);
    expect(method, 'compression method 0 is STORE').toBe(0);
    expect(zipped.length).toBeGreaterThan(data.length);
  });
});
