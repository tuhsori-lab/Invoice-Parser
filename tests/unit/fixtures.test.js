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
import { createProfile } from '../../src/core/profiles.js';
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
