/**
 * What each sample PDF should produce.
 *
 * This is the list of layouts the splitter promises to handle, written out so a
 * change to detection either keeps every promise or fails loudly. Each entry
 * says which real-world layout it stands for, which settings it needs, and
 * exactly which pages should end up in which invoice, with the label the number
 * was found after.
 */

import { createProfile } from '../../src/core/profiles.js';

/** The client whose invoices use a label nothing recognises by default. */
export const LUCERNE = createProfile({
  id: 'lucerne',
  name: 'Lucerne Publishing',
  labels: ['Our Ref'],
  identifyingText: ['Lucerne Publishing'],
});

/** Two clients that share one bulk file, each with its own way of printing. */
export const NORTHWIND = createProfile({
  id: 'northwind',
  name: 'Northwind Traders',
  labels: ['Our Ref'],
  extraLabel: 'Store #',
  identifyingText: ['Northwind Traders'],
});

export const CONTOSO = createProfile({
  id: 'contoso',
  name: 'Contoso Supply Co.',
  labels: ['Statement Ref'],
  extraLabel: 'Store #',
  identifyingText: ['Contoso Supply Co.'],
});

/**
 * @typedef {object} FixtureCase
 * @property {number} case the numbered case from the build specification.
 * @property {string} file the sample PDF.
 * @property {string} what the layout this case stands for, in plain language.
 * @property {object} [detect] settings for analyze.js.
 * @property {object} [group] settings for group.js.
 * @property {number} pages how many pages the file has.
 * @property {Array<object>} groups the invoices that should come out.
 */

/** @type {FixtureCase[]} */
export const CASES = [
  {
    case: 1,
    file: '01-same-line.pdf',
    what: 'Label and number on the same line, and a second page with no number',
    pages: 2,
    groups: [
      {
        invoice: '104233',
        pages: [1, 2],
        label: 'Invoice #:',
        source: 'common',
        flags: [],
        continuation: [2],
      },
    ],
  },
  {
    case: 2,
    file: '02-table-header.pdf',
    what: 'Table header "Invoice No. Date Terms" with the values on the next line',
    pages: 1,
    groups: [{ invoice: '104501', pages: [1], label: 'Invoice No.', source: 'common', flags: [] }],
  },
  {
    case: 3,
    file: '03-repeated-number.pdf',
    what: 'One invoice over three pages, the number printed on every page',
    pages: 3,
    groups: [
      {
        invoice: '100777',
        pages: [1, 2, 3],
        label: 'Invoice #:',
        source: 'common',
        flags: [],
        continuation: [],
      },
    ],
  },
  {
    case: 4,
    file: '04-remittance-slip.pdf',
    what: 'A remittance slip with no number, kept with the invoice before it',
    pages: 2,
    groups: [
      {
        invoice: '100888',
        pages: [1, 2],
        label: 'Invoice #:',
        source: 'common',
        flags: [],
        continuation: [2],
      },
    ],
  },
  {
    case: 4.1,
    file: '04-remittance-slip.pdf',
    what: 'The same slip, set aside for review instead of being attached',
    group: { unnumbered: 'review' },
    pages: 2,
    groups: [
      { invoice: '100888', pages: [1], label: 'Invoice #:', source: 'common', flags: [] },
      { invoice: null, pages: [2], flags: ['no-number'] },
    ],
  },
  {
    case: 5,
    file: '05-repeat-later.pdf',
    what: 'The same number appearing again later in the file, left as separate invoices',
    pages: 3,
    groups: [
      {
        invoice: 'INV-2001',
        pages: [1],
        label: 'Invoice No:',
        source: 'common',
        // Two separate invoices carry the same number, so both are flagged and
        // the second is saved under a name of its own rather than overwriting.
        flags: ['duplicate-name'],
        fileName: 'INV-2001.pdf',
      },
      { invoice: 'INV-2002', pages: [2], label: 'Invoice No:', source: 'common', flags: [] },
      {
        invoice: 'INV-2001',
        pages: [3],
        label: 'Invoice No:',
        source: 'common',
        flags: ['duplicate-name'],
        fileName: 'INV-2001 (2).pdf',
      },
    ],
  },
  {
    case: 5.1,
    file: '05-repeat-later.pdf',
    what: 'The same file with "combine pages that share a number" turned on',
    group: { combinePages: true },
    pages: 3,
    groups: [
      { invoice: 'INV-2001', pages: [1, 3], label: 'Invoice No:', source: 'common', flags: [] },
      { invoice: 'INV-2002', pages: [2], label: 'Invoice No:', source: 'common', flags: [] },
    ],
  },
  {
    case: 6,
    file: '06-split-text-runs.pdf',
    what: 'A number the PDF draws as two runs ("7788" then "12")',
    pages: 1,
    groups: [{ invoice: '778812', pages: [1], label: 'Invoice #:', source: 'common', flags: [] }],
  },
  {
    case: 7,
    file: '07-bare-invoice.pdf',
    what: 'Bare "INVOICE 445566", with a street number on the line below',
    pages: 1,
    groups: [
      { invoice: '445566', pages: [1], label: 'INVOICE', source: 'bare', flags: ['fallback'] },
    ],
  },
  {
    case: 8,
    file: '08-title-and-address.pdf',
    what: 'An "INVOICE" title, an address with a ZIP code, and the number further down',
    pages: 1,
    groups: [{ invoice: 'A-10045', pages: [1], label: 'Inv#:', source: 'common', flags: [] }],
  },
  {
    case: 9,
    file: '09-date-before-number.pdf',
    what: 'A date printed before the number on the same line',
    pages: 1,
    groups: [{ invoice: '3344', pages: [1], label: 'Invoice No:', source: 'common', flags: [] }],
  },
  {
    case: 10,
    file: '10-bill-no.pdf',
    what: '"Bill No." rather than "Invoice No."',
    pages: 1,
    groups: [{ invoice: '55667', pages: [1], label: 'Bill No.', source: 'common', flags: [] }],
  },
  {
    case: 11,
    file: '11-document-number.pdf',
    what: '"Document Number" with the value on the line below',
    pages: 1,
    groups: [
      { invoice: 'DN-90210', pages: [1], label: 'Document Number', source: 'common', flags: [] },
    ],
  },
  {
    case: 12,
    file: '12-unusual-label.pdf',
    what: 'An unusual label that nothing recognises by default',
    pages: 1,
    groups: [{ invoice: null, pages: [1], flags: ['no-number'] }],
  },
  {
    case: 12.1,
    file: '12-unusual-label.pdf',
    what: 'The same page once "Our Ref" has been added to a client profile',
    detect: { profiles: [LUCERNE] },
    pages: 1,
    groups: [
      {
        invoice: '889900',
        pages: [1],
        label: 'Our Ref',
        source: 'profile',
        client: 'Lucerne Publishing',
        flags: [],
      },
    ],
  },
  {
    case: 13,
    file: '13-invoice-notes.pdf',
    what: '"Invoice Notes: 100 units" must not be read as the invoice number',
    pages: 1,
    groups: [{ invoice: '990011', pages: [1], label: 'Invoice #:', source: 'common', flags: [] }],
  },
  {
    case: 14,
    file: '14-two-clients.pdf',
    what: 'Two clients in one file, each matched to its own profile',
    detect: { profiles: [NORTHWIND, CONTOSO] },
    pages: 3,
    groups: [
      {
        invoice: 'NW-5501',
        pages: [1, 2],
        label: 'Our Ref',
        source: 'profile',
        client: 'Northwind Traders',
        extra: '218',
        flags: [],
        continuation: [2],
      },
      {
        invoice: 'CS-7702',
        pages: [3],
        label: 'Statement Ref',
        source: 'profile',
        client: 'Contoso Supply Co.',
        extra: '442',
        flags: [],
      },
    ],
  },
  {
    case: 17,
    file: '17-marker-pages.pdf',
    what: 'Pages only a marker phrase can separate',
    group: { mode: 'by-marker', markerText: 'Page 1 of' },
    pages: 5,
    groups: [
      { invoice: null, pages: [1, 2], flags: ['no-number'] },
      { invoice: null, pages: [3, 4, 5], flags: ['no-number'] },
    ],
  },
  {
    case: 17.1,
    file: '17-marker-pages.pdf',
    what: 'The same file split every two pages',
    group: { mode: 'every-n', pagesPerInvoice: 2 },
    pages: 5,
    groups: [
      { invoice: null, pages: [1, 2], flags: ['no-number'] },
      { invoice: null, pages: [3, 4], flags: ['no-number'] },
      { invoice: null, pages: [5], flags: ['no-number'] },
    ],
  },
  {
    case: 20,
    file: '20-form-layout.pdf',
    what: 'A filled-in form: the labels drawn in one pass, the values in another',
    pages: 1,
    groups: [{ invoice: '1043396', pages: [1], label: 'INVOICE NO.', source: 'common', flags: [] }],
  },
  {
    case: 21,
    file: '21-column-heading.pdf',
    what: 'A column heading with its number below it, the number carrying a suffix',
    pages: 2,
    groups: [
      { invoice: 'SR-40881_2', pages: [1], label: 'Invoice #', source: 'common', flags: [] },
      { invoice: 'SR-40997_1', pages: [2], label: 'Invoice #', source: 'common', flags: [] },
    ],
  },
  {
    case: 18,
    file: '18-conflicting-numbers.pdf',
    what: 'Two different numbers after two different labels on one page',
    pages: 1,
    groups: [
      {
        invoice: '1111',
        pages: [1],
        label: 'Invoice No:',
        source: 'common',
        flags: ['conflict'],
      },
    ],
  },
];

/** Cases that never get as far as grouping. */
export const SPECIAL_CASES = {
  passwordProtected: {
    case: 15,
    file: '15-password-protected.pdf',
    what: 'A file that cannot be opened without a password',
    password: 'secret',
  },
  imageOnly: {
    case: 16,
    file: '16-image-only.pdf',
    what: 'A page that is only a picture, so it has to go through text recognition',
  },
};
