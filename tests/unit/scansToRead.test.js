/**
 * Which pages are offered to be read as pictures.
 */

import { describe, expect, it, vi } from 'vitest';

// The part that asks pdf.js about a page is not needed here.
vi.mock('../../src/lib/pdfjs.js', () => ({ pdfjs: {} }));

const { pictureKey, scansToRead } = await import('../../src/lib/pictures.js');

const scan = { share: 0.95, pixelsAcross: 2480 };
const page = (index, extra = {}) => ({
  index,
  fileId: 'f',
  pageNumberInFile: index,
  ocr: false,
  hasText: true,
  text: 'Customs note',
  detection: null,
  matchedProfiles: [],
  ...extra,
});
const box = { id: 'box-1', zone: { x0: 0.7, x1: 0.83, y0: 0.81, y1: 0.83 } };

describe('scanned pages to read', () => {
  it('include a scan with a few words on top and no number', () => {
    const pages = [page(5)];
    const pictures = new Map([[pictureKey(pages[0]), scan]]);
    expect(scansToRead(pages, pictures).map((entry) => entry.index)).toEqual([5]);
  });

  it('still include one with a few words on top, put with an invoice a box numbered', () => {
    // Page 2 is typed, with its number in the box; pages 3 and 4 are scans put
    // with it only because they have no number of their own yet.
    const pages = [
      page(2, { detection: { value: '2031/HM/00217', source: 'zone' }, matchedProfiles: [box] }),
      page(3, { pageHeight: 842, layout: [{ y: 700 }, { y: 600 }] }),
      page(4),
    ];
    const pictures = new Map(pages.map((entry) => [pictureKey(entry), scan]));
    const boxed = new Set([2, 3, 4]);
    expect(scansToRead(pages, pictures, boxed).map((entry) => entry.index)).toEqual([3, 4]);
  });

  it("leave out one in a boxed invoice whose own text covers the page, as a scanner's does", () => {
    const pages = [page(3, { pageHeight: 842, layout: [{ y: 800 }, { y: 400 }, { y: 30 }] })];
    const pictures = new Map([[pictureKey(pages[0]), scan]]);
    expect(scansToRead(pages, pictures, new Set([3]))).toEqual([]);
    // The same page not in a boxed invoice is still offered.
    expect(scansToRead(pages, pictures).map((entry) => entry.index)).toEqual([3]);
  });

  it('leave out a scan whose own text names a client with a box', () => {
    // Its text is a reading of the paper good enough to know the client by, and
    // an empty box means it is a later page of an invoice.
    const pages = [page(3, { matchedProfiles: [box] })];
    const pictures = new Map([[pictureKey(pages[0]), scan]]);
    expect(scansToRead(pages, pictures)).toEqual([]);
  });

  it('leave out a page already read', () => {
    const pages = [page(3, { ocr: true, hasText: false })];
    expect(scansToRead(pages, new Map())).toEqual([]);
  });
});
