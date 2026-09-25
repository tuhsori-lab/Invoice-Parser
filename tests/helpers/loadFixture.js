/**
 * Opening the sample PDFs in a test.
 *
 * The app reads PDFs in a browser worker; a test reads them straight from disk
 * with the same pdf.js build. Either way the text goes through the same
 * extractText.js, which is the part being tested.
 */

import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { extractDocumentText } from '../../src/core/extractText.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Where pdf.js keeps the metrics for the fonts every PDF may assume exist.
 * The browser build loads these from the bundle; in Node they are read from
 * node_modules, which also stops pdf.js warning about them on every file.
 */
const STANDARD_FONTS = join(
  dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json')),
  'standard_fonts/'
);

/** Where `npm run fixtures` puts the sample PDFs. */
export const FIXTURE_DIR = join(HERE, '..', 'fixtures', 'pdf');

/** The bytes of one sample PDF. */
export async function readFixture(name) {
  return new Uint8Array(await readFile(join(FIXTURE_DIR, name)));
}

/**
 * Open a sample PDF with pdf.js.
 *
 * @param {string} name
 * @returns {Promise<import('pdfjs-dist').PDFDocumentProxy>}
 */
export async function openFixture(name) {
  const data = await readFixture(name);
  return pdfjs.getDocument({
    data,
    isEvalSupported: false,
    useSystemFonts: false,
    standardFontDataUrl: STANDARD_FONTS,
  }).promise;
}

/**
 * Read one sample PDF the way the app does: every page, with its text and
 * where that text came from.
 *
 * @param {string} name
 * @returns {Promise<Array<object>>} pages ready for analyze.js.
 */
export async function loadFixturePages(name) {
  const document = await openFixture(name);
  const extracted = await extractDocumentText(document);
  return extracted.map((page, position) => ({
    index: position + 1,
    fileId: name,
    fileName: name,
    filePageIndex: position,
    text: page.text,
    hasText: page.hasText,
    layout: page.layout,
    ocr: false,
  }));
}

/**
 * Read several sample PDFs as one batch, the way the app does when a user drops
 * more than one file in.
 *
 * @param {string[]} names
 * @returns {Promise<Array<object>>}
 */
export async function loadFixtureBatch(names) {
  const pages = [];
  for (const name of names) {
    const filePages = await loadFixturePages(name);
    for (const page of filePages) pages.push({ ...page, index: pages.length + 1 });
  }
  return pages;
}
