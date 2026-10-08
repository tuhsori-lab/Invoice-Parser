/**
 * The promise this app makes: every invoice layout in the sample PDFs is split
 * correctly, and says where its number came from.
 *
 * Each case runs the whole engine - read the PDF, detect, group, name - and
 * checks the invoices that come out, page by page.
 */

import { describe, expect, it } from 'vitest';
import { analyzePages } from '../../src/core/analyze.js';
import { groupPages } from '../../src/core/group.js';
import { assignFileNames } from '../../src/core/naming.js';
import { classifyError } from '../../src/core/errors.js';
import { createProfile, identifyingLinesFor } from '../../src/core/profiles.js';
import { buildRecognisedText } from '../../src/core/extractText.js';
import { describePicture, isPicture } from '../../src/core/scans.js';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { CASES, HARBOR_PINE, SPECIAL_CASES } from '../fixtures/expected.js';
import { loadFixturePages, openFixture } from '../helpers/loadFixture.js';

/** Run one sample PDF through the engine, exactly as the app does. */
async function split(entry) {
  const pages = await loadFixturePages(entry.file);
  const analyzed = analyzePages(pages, entry.detect ?? {});
  const groups = groupPages(analyzed, entry.group ?? {});
  return { pages: analyzed, groups: assignFileNames(groups) };
}

describe('every sample layout', () => {
  for (const entry of CASES) {
    it(`case ${entry.case}: ${entry.what}`, async () => {
      const { pages, groups } = await split(entry);

      expect(pages).toHaveLength(entry.pages);
      expect(
        groups.map((group) => ({ invoice: group.invoice, pages: group.pages.map((p) => p.index) }))
      ).toEqual(
        entry.groups.map(({ invoice, pages: pageNumbers }) => ({
          invoice,
          pages: pageNumbers,
        }))
      );

      entry.groups.forEach((wanted, position) => {
        const group = groups[position];

        if (wanted.label !== undefined) {
          expect(group.provenance?.label, 'label the number was found after').toBe(wanted.label);
        }
        if (wanted.source !== undefined) {
          expect(group.provenance?.source, 'which tier found it').toBe(wanted.source);
        }
        if (wanted.client !== undefined) {
          expect(group.client, 'client profile that recognised the page').toBe(wanted.client);
        }
        if (wanted.extra !== undefined) {
          expect(group.extra?.value, 'extra field').toBe(wanted.extra);
        }
        if (wanted.po !== undefined) {
          expect(group.po?.value ?? null, 'purchase order').toBe(wanted.po);
        }
        if (wanted.continuation !== undefined) {
          expect(group.continuationPages, 'pages carried over from the page before').toEqual(
            wanted.continuation
          );
        }
        if (wanted.flags !== undefined) {
          expect(group.flags, 'review flags').toEqual(wanted.flags);
        }
        if (wanted.fileName !== undefined) {
          expect(group.fileName, 'file name').toBe(wanted.fileName);
        }
        expect(group.fileName, 'every invoice gets a file name').toMatch(/\.pdf$/);
      });
    });
  }
});

describe('files the engine cannot read on its own', () => {
  it(`case ${SPECIAL_CASES.passwordProtected.case}: ${SPECIAL_CASES.passwordProtected.what}`, async () => {
    await expect(openFixture(SPECIAL_CASES.passwordProtected.file)).rejects.toSatisfy(
      (error) => classifyError(error) === 'password-protected'
    );
  });

  it(`case ${SPECIAL_CASES.imageOnly.case}: ${SPECIAL_CASES.imageOnly.what}`, async () => {
    const pages = await loadFixturePages(SPECIAL_CASES.imageOnly.file);

    expect(pages).toHaveLength(1);
    expect(pages[0].hasText, 'a picture of a page has no text to read').toBe(false);

    // Once text recognition has read it, the same pipeline takes over.
    const recognised = analyzePages(
      [{ ...pages[0], text: 'SOUTHRIDGE VIDEO\nINVOICE #: 552211\nTOTAL DUE 1450.00', ocr: true }],
      {}
    );
    const [group] = groupPages(recognised, {});
    expect(group.invoice).toBe('552211');
    expect(group.flags, 'text read from a scan is always worth checking').toContain('ocr');
  });
});

describe('scanned pages with a few words typed on top', () => {
  const entry = SPECIAL_CASES.scannedWithNotes;

  /** What text recognition reads off one sheet, as lines of positioned words. */
  function recognised({ number, label, sheet, note }) {
    const scale = 2480 / 595;
    const line = (top, left, words) => {
      let x = left;
      const placed = words.map((text) => {
        const box = {
          x0: x * scale,
          y0: top * scale,
          x1: (x + text.length * 6.5) * scale,
          y1: (top + 7) * scale,
        };
        x += (text.length + 1) * 6.5;
        return { text, bbox: box, confidence: 90 };
      });
      return {
        bbox: {
          x0: placed[0].bbox.x0,
          y0: top * scale,
          x1: placed.at(-1).bbox.x1,
          y1: (top + 7) * scale,
        },
        words: placed,
      };
    };
    const lines = [
      line(36, 36, ['VALLOMBROSA', 'TESSUTI', 'SPA']),
      line(50, 36, ['VIA', 'DEI', 'TELAI', '14', '40066', 'REGGELLO']),
      line(168, 350, [...label.split(' '), number, 'PAG', String(sheet)]),
      ...(note ? [line(230, 36, note.split(' '))] : []),
      line(820, 10, ['CUSTOMS', 'COPY', '-', 'HS', '6205.20']),
    ];
    return buildRecognisedText(lines, { scale, pageHeight: 842 });
  }

  it(`case ${entry.case}: ${entry.what}`, async () => {
    const pages = await loadFixturePages(entry.file);

    expect(pages).toHaveLength(3);
    for (const page of pages) {
      expect(page.hasText, 'the typed note is real text').toBe(true);
    }
    const [group] = groupPages(analyzePages(pages, {}), {});
    expect(group.invoice, 'the note carries no invoice number').toBeNull();
  });

  it('knows every page for a picture of paper, scanned at 300 dpi', async () => {
    const document = await openFixture(entry.file);
    for (let number = 1; number <= document.numPages; number += 1) {
      const page = await document.getPage(number);
      const { width, height } = page.getViewport({ scale: 1 });
      const picture = describePicture(await page.getOperatorList(), pdfjs.OPS, width, height);

      expect(isPicture(picture)).toBe(true);
      expect(picture.pixelsAcross).toBe(2480);
    }
  });

  it('once read, splits into the invoice and the credit note that refers to it', async () => {
    const pages = await loadFixturePages(entry.file);
    const read = pages.map((page, position) => ({
      ...page,
      ...recognised(entry.read[position]),
      ocr: true,
    }));
    const groups = assignFileNames(groupPages(analyzePages(read, {}), {}));

    expect(
      groups.map((group) => ({
        invoice: group.invoice,
        pages: group.pages.map((page) => page.index),
        fileName: group.fileName,
      }))
    ).toEqual(entry.groups);
    for (const group of groups) expect(group.flags).toContain('ocr');
  });

  it('reads the whole batch from a box drawn on one scanned page', async () => {
    const pages = await loadFixturePages(entry.file);
    const read = pages.map((page, position) => ({
      ...page,
      ...recognised(entry.read[position]),
      ocr: true,
    }));
    const [first] = read;
    const at = first.text.indexOf('2031/TB/00412');
    const span = first.layout.find((part) => part.start <= at && part.end > at);
    const box = createProfile({
      name: 'VALLOMBROSA TESSUTI SPA',
      identifyingText: ['VALLOMBROSA TESSUTI SPA', 'VIA DEI TELAI 14 40066 REGGELLO'],
      zone: {
        x0: span.x / first.pageWidth,
        x1: span.endX / first.pageWidth,
        y0: span.y / first.pageHeight,
        y1: (span.y + span.fontSize) / first.pageHeight,
      },
      zoneShape: 'D4 / A2 / D5',
    });
    const groups = groupPages(analyzePages(read, { profiles: [box] }), {});

    expect(groups.map((group) => [group.invoice, group.provenance?.source])).toEqual([
      ['2031/TB/00412', 'zone'],
      ['2031/TB/00587', 'zone'],
    ]);
  });
});

describe("scanned printouts that carry the scanner's own text", () => {
  const file = '24-scanned-with-own-text.pdf';

  /** The box somebody draws around the PO number on page 1. */
  function boxOnFirstPage(pages) {
    const [first] = pages;
    const span = first.layout.find(
      (part) => first.text.slice(part.start, part.end) === '7730051-1107' && part.x > 300
    );
    return createProfile({
      name: 'drawn on page 1',
      identifyingText: identifyingLinesFor(first, pages),
      zone: {
        x0: span.x / first.pageWidth,
        x1: span.endX / first.pageWidth,
        y0: span.y / first.pageHeight,
        y1: (span.y + span.fontSize) / first.pageHeight,
      },
      zoneShape: 'D7 - D4',
    });
  }

  it('case 24: every page is a picture, with text of its own, and no invoice number in it', async () => {
    const pages = await loadFixturePages(file);
    const document = await openFixture(file);

    expect(pages).toHaveLength(5);
    for (const [position, page] of pages.entries()) {
      expect(page.hasText).toBe(true);
      const pdfPage = await document.getPage(position + 1);
      const { width, height } = pdfPage.getViewport({ scale: 1 });
      expect(
        isPicture(describePicture(await pdfPage.getOperatorList(), pdfjs.OPS, width, height))
      ).toBe(true);
    }
    expect(groupPages(analyzePages(pages, {}), {})[0].invoice).toBeNull();
  });

  it('knows the client by what its pages share, not by a first line that changes every time', async () => {
    const pages = await loadFixturePages(file);
    const lines = identifyingLinesFor(pages[0], pages);

    expect(lines[0]).toBe('Paid Fulfilled Notes');
    expect(lines.join(' ')).not.toContain('10:12');
  });

  it('reads every order from a box drawn on the first, whatever the length of its number', async () => {
    const pages = await loadFixturePages(file);
    const groups = assignFileNames(
      groupPages(analyzePages(pages, { profiles: [boxOnFirstPage(pages)] }), {})
    );

    expect(
      groups.map((group) => ({
        invoice: group.invoice,
        pages: group.pages.map((page) => page.index),
        source: group.provenance?.source,
      }))
    ).toEqual([
      { invoice: '7730051-1107', pages: [1, 2], source: 'zone' },
      { invoice: '9902114705-0031', pages: [3], source: 'zone' },
      { invoice: '7730051-1103', pages: [4, 5], source: 'zone' },
    ]);
  });
});

describe('a box saved in a batch from two clients', () => {
  it('is known by the letterhead, not a table heading both clients print', async () => {
    const pages = [
      ...(await loadFixturePages('22-boxed-number.pdf')),
      ...(await loadFixturePages('21-column-heading.pdf')),
    ].map((page, position) => ({ ...page, index: position + 1 }));
    const [first] = pages;
    const zone = HARBOR_PINE.zone;
    const lines = identifyingLinesFor(first, pages, { leaveOut: '50621', zone, shape: 'D5' });

    expect(lines[0]).toBe('Harbor & Pine Apparel');
    const box = createProfile({ name: 'x', identifyingText: lines, zone, zoneShape: 'D5' });
    const groups = groupPages(analyzePages(pages, { profiles: [box] }), {});
    // The other client's pages are still read by their own label, not the box.
    expect(groups.map((group) => [group.invoice, group.provenance?.source])).toEqual([
      ['50621', 'zone'],
      ['50698', 'zone'],
      ['SR-40881_2', 'common'],
      ['SR-40997_1', 'common'],
    ]);
  });
});

describe('invoices to several customers, with a page of terms after each', () => {
  it('case 25: reads every invoice from a box drawn on the first, and keeps the terms with each', async () => {
    const pages = await loadFixturePages('25-invoices-with-terms.pdf');
    const [first] = pages;
    const span = first.layout.find(
      (part) => first.text.slice(part.start, part.end) === 'SI-7710001'
    );
    const box = createProfile({
      name: 'drawn on page 1',
      identifyingText: identifyingLinesFor(first, pages, { leaveOut: 'SI-7710001' }),
      zone: {
        x0: span.x / first.pageWidth,
        x1: span.endX / first.pageWidth,
        y0: span.y / first.pageHeight,
        y1: (span.y + span.fontSize) / first.pageHeight,
      },
      zoneShape: 'A2 - D7',
    });

    // Known by the letterhead, never by the first customer or the boxed number.
    expect(box.identifyingText[0]).toBe('MARLOWE ATELIER VAT #: IT00999888777 Invoice');
    expect(box.identifyingText.join(' ')).not.toMatch(/TIDEWATER|SI-7710001/);

    const groups = groupPages(analyzePages(pages, { profiles: [box] }), {});
    expect(groups.map((group) => [group.invoice, group.pages.map((page) => page.index)])).toEqual([
      ['SI-7710001', [1, 2]],
      ['SI-7710002', [3, 4]],
      ['SI-7710015', [5, 6]],
      ['SI-7710021', [7, 8]],
    ]);
  });
});

describe('pointing at where the number is', () => {
  /**
   * The whole point of a saved spot: shown once where the number is, the app
   * reads the same place on every other invoice from that client - without
   * being told a single thing about the wording around it.
   */
  it('reads a whole batch from the spot pointed at on one page', async () => {
    const pages = await loadFixturePages('21-column-heading.pdf');
    const [first] = pages;

    // What the preview works out when somebody highlights the number: the box
    // it covers, as fractions of the page's own size.
    const at = first.text.indexOf('SR-40881_2');
    const span = first.layout.find((entry) => entry.start <= at && entry.end > at);
    const zone = {
      x0: span.x / first.pageWidth,
      x1: span.endX / first.pageWidth,
      y0: span.y / first.pageHeight,
      y1: (span.y + span.fontSize) / first.pageHeight,
    };

    const profile = createProfile({
      name: 'Anchor Textile Group',
      identifyingText: ['Anchor Textile Group'],
      zone,
    });

    const analyzed = analyzePages(pages, { profiles: [profile] });
    const groups = groupPages(analyzed, {});

    expect(groups.map((group) => group.invoice)).toEqual(['SR-40881_2', 'SR-40997_1']);
    expect(groups.map((group) => group.provenance?.source)).toEqual(['zone', 'zone']);
    expect(groups.map((group) => group.provenance?.label)).toEqual([
      'Anchor Textile Group',
      'Anchor Textile Group',
    ]);
  });

  it('still reads the batch when the spot is pointed at nothing', async () => {
    const pages = await loadFixturePages('21-column-heading.pdf');
    const profile = createProfile({
      name: 'Anchor Textile Group',
      identifyingText: ['Anchor Textile Group'],
      zone: { x0: 0.05, y0: 0.1, x1: 0.2, y1: 0.2 },
    });

    const groups = groupPages(analyzePages(pages, { profiles: [profile] }), {});

    expect(groups.map((group) => group.invoice)).toEqual(['SR-40881_2', 'SR-40997_1']);
    expect(groups.map((group) => group.provenance?.source)).toEqual(['common', 'common']);
  });
});

describe('a saved spot on a client with continuation pages', () => {
  it('passes over a subtotal in the spot, because it is not shaped like the number', async () => {
    const pages = await loadFixturePages('22-boxed-number.pdf');
    const shapeless = createProfile({ ...HARBOR_PINE, zoneShape: '' });

    const withShape = groupPages(analyzePages(pages, { profiles: [HARBOR_PINE] }), {});
    const without = groupPages(analyzePages(pages, { profiles: [shapeless] }), {});

    expect(withShape.map((group) => group.invoice)).toEqual(['50621', '50698']);
    // Without the shape, the subtotal each continuation page carries in that
    // same spot is read as an invoice number of its own. This is what the
    // shape is there to stop.
    expect(without.map((group) => group.invoice)).toContain('472');
  });
});
