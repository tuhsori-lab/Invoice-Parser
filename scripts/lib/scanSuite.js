/**
 * The harder scanned fixtures: what is on each page, and what the right answer is.
 *
 * Kept in one place so the script that draws the pages (make-fixtures.js) and
 * the benchmark that marks the app's answers (scripts/bench.js) can never
 * disagree about what a page says. Plain data and arithmetic only - this file is
 * also loaded in the browser by the benchmark page.
 *
 * Every company, address and number here is invented.
 */

/** An A4 page, in points. */
export const SHEET = { width: 595, height: 842 };

/**
 * Where things sit on an invoice, in points from the top-left corner. The
 * invoice number follows "Invoice No:" on the same line, so the everyday label
 * tier can find it - and it is also where a box would be drawn.
 */
export const LAYOUT = {
  supplier: { x: 56, y: 70, size: 15, bold: true },
  address: { x: 56, y: 86, size: 9 },
  title: { x: 400, y: 120, size: 18, bold: true },
  numberLabel: { x: 380, y: 146, size: 10 },
  number: { x: 455, y: 146, size: 10 },
  dateLabel: { x: 380, y: 162, size: 10 },
  date: { x: 455, y: 162, size: 10 },
  billTo: { x: 56, y: 146, size: 9, bold: true },
  customer: { x: 56, y: 160, size: 10 },
  customerAddress: { x: 56, y: 174, size: 9 },
  tableTop: 230,
  footer: { x: 260, y: 800, size: 9 },
};

/**
 * The box somebody would draw around the number on these invoices: as
 * fractions of the page, y measured up from the bottom, as boxes are kept.
 *
 * @param {number} numberWidth - how wide the widest number is, in points.
 */
export function numberBox(numberWidth) {
  const { x, y, size } = LAYOUT.number;
  return {
    x0: (x - 3) / SHEET.width,
    x1: (x + numberWidth + 3) / SHEET.width,
    y0: (SHEET.height - y - 3) / SHEET.height,
    y1: (SHEET.height - y + size + 1) / SHEET.height,
  };
}

/**
 * One fixture each for the ways a scan goes wrong. `invoices` lists each
 * invoice's number and page count; `numberOnEvery` repeats the number on the
 * pages after the first, as many invoices do; `pageOf` prints "Page X of Y".
 */
export const SCAN_SUITE = [
  {
    case: 26,
    file: '26-scan-tilted.pdf',
    what: 'Scanned crooked: one degree, two the other way, three',
    supplier: 'Marrowbone Textiles',
    address: '4 Weaver Row, Halden HX7 2QP',
    tilts: [1, -2, 3],
    invoices: [
      { number: 'INV-30117', pages: 1 },
      { number: 'INV-30118', pages: 1 },
      { number: 'INV-30125', pages: 1 },
    ],
  },
  {
    case: 27,
    file: '27-scan-150dpi.pdf',
    what: 'Scanned at 150 dots per inch, half the usual detail',
    supplier: 'Quillfeather Paper Co.',
    address: '19 Mill Lane, Ashby AB3 9LD',
    dpi: 150,
    invoices: [
      { number: '718840', pages: 1 },
      { number: '718841', pages: 1 },
      { number: '718856', pages: 1 },
    ],
  },
  {
    case: 28,
    file: '28-scan-faint.pdf',
    what: 'Faint grey print, as from a printer running out of toner',
    supplier: 'Fernhill Coffee Roasters',
    address: '88 Kiln Street, Brockby BR2 6TE',
    ink: [150, 150, 150],
    strength: 0.85,
    invoices: [
      { number: 'FC-20931', pages: 1 },
      { number: 'FC-20944', pages: 1 },
      { number: 'FC-20950', pages: 1 },
    ],
  },
  {
    case: 29,
    file: '29-scan-colored.pdf',
    what: 'Dark blue print on yellowed paper',
    supplier: 'Northwick Hardware',
    address: '3 Foundry Yard, Northwick NW4 1HB',
    paper: [246, 236, 196],
    ink: [30, 40, 90],
    invoices: [
      { number: 'NW-55102', pages: 1 },
      { number: 'NW-55108', pages: 1 },
      { number: 'NW-55131', pages: 1 },
    ],
  },
  {
    case: 30,
    file: '30-scan-speckled.pdf',
    what: 'Dust and dropouts all over the page',
    supplier: 'Saltmarsh Fisheries',
    address: '12 Harbour Wall, Saltby SB9 4FF',
    specks: 9000,
    invoices: [
      { number: '664120', pages: 1 },
      { number: '664127', pages: 1 },
      { number: '664133', pages: 1 },
    ],
  },
  {
    case: 31,
    file: '31-scan-stamp.pdf',
    what: 'A red PAID stamp across the invoice number',
    supplier: 'Hollowpine Joinery',
    address: '7 Sawpit Close, Hollow HP5 8JJ',
    stamp: true,
    invoices: [
      { number: 'HP-81450', pages: 1 },
      { number: 'HP-81466', pages: 1 },
      { number: 'HP-81472', pages: 1 },
    ],
  },
  {
    case: 32,
    file: '32-scan-lookalikes.pdf',
    what: 'Numbers mixing letters and digits that look alike: S and 5, O and 0, I and 1, B and 8',
    supplier: 'Osbourne & Bligh',
    address: '51 Chandlers Quay, Osby OS1 5BB',
    invoices: [
      { number: 'SO-80155', pages: 1 },
      { number: 'IB-10518', pages: 1 },
      { number: 'BS-58010', pages: 1 },
    ],
  },
  {
    case: 33,
    file: '33-scan-page-x-of-y.pdf',
    what: 'Invoices of one, two and three pages, each page marked "Page X of Y"',
    supplier: 'Larchmont Printing',
    address: '20 Press Street, Larchmont LM6 2PP',
    pageOf: true,
    invoices: [
      { number: '552190', pages: 2, numberOnEvery: true },
      { number: '552204', pages: 3 },
      { number: '552210', pages: 1 },
    ],
  },
  {
    case: 34,
    file: '34-scan-suffix.pdf',
    what: 'Invoices told apart only by a suffix: 40017822, 40017822_2 and 40017822_3',
    supplier: 'Kestrel Logistics',
    address: '9 Depot Road, Kestrel KL2 7DD',
    invoices: [
      { number: '40017822', pages: 2, numberOnEvery: true },
      { number: '40017822_2', pages: 1 },
      { number: '40017822_3', pages: 1 },
    ],
  },
];

/**
 * The answer each fixture should give: one entry per invoice, with the pages
 * it is made of, counting from 1 through the file.
 *
 * @param {object} fixture - an entry of SCAN_SUITE.
 * @returns {Array<{ invoice: string, pages: number[] }>}
 */
export function expectedGroups(fixture) {
  const groups = [];
  let page = 1;
  for (const invoice of fixture.invoices) {
    const pages = [];
    for (let count = 0; count < invoice.pages; count += 1) pages.push(page + count);
    groups.push({ invoice: invoice.number, pages });
    page += invoice.pages;
  }
  return groups;
}

/**
 * The box a person would draw for a fixture's supplier: around the number,
 * wide enough for the longest of them (about seven points a character at ten
 * point), with the supplier's name as the line their pages are known by.
 *
 * @param {object} fixture - an entry of SCAN_SUITE.
 */
export function boxFor(fixture) {
  const longest = Math.max(...fixture.invoices.map((invoice) => invoice.number.length));
  return {
    name: fixture.supplier,
    identifyingText: [fixture.supplier],
    zone: numberBox(longest * 7),
  };
}
