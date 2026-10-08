#!/usr/bin/env node
/**
 * Build the sample PDFs the tests run against.
 *
 * Every invoice in here is made up. The companies do not exist, the addresses
 * are invented, and no file in this repository has ever contained real invoice
 * data. That is deliberate and permanent: this is a public project, and the
 * people it is for handle confidential client information.
 *
 * Run with: npm run fixtures
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { buildEncryptedPdf } from './lib/encryptedPdf.js';
import { createCanvas, drawText as drawBitmapText, soften } from './lib/bitmapFont.js';
import { encodeGrayPng, encodeRgbPng } from './lib/png.js';
import {
  blur,
  createSheet,
  drawFrame,
  drawRule,
  speckle,
  textWidth,
  tilt,
  writeText,
} from './lib/scanImage.js';
import { LAYOUT, SCAN_SUITE, SHEET } from './lib/scanSuite.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const FIXTURE_DIR = join(HERE, '..', 'tests', 'fixtures', 'pdf');

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 56;
const INK = rgb(0.1, 0.1, 0.12);
const FAINT = rgb(0.45, 0.45, 0.5);

/**
 * A page description: a list of lines, each with a position and a style.
 * `runs` splits one line into separate pieces of drawn text, which is how a real
 * PDF can print "778812" as "7788" and "12".
 */
function line(text, options = {}) {
  return { text, ...options };
}

/** Draw one page from a list of lines and hand back the page. */
function drawPage(pdf, fonts, lines) {
  const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let cursorY = PAGE_HEIGHT - MARGIN;

  for (const entry of lines) {
    const size = entry.size ?? 10;
    const font = entry.bold ? fonts.bold : fonts.regular;
    const color = entry.faint ? FAINT : INK;
    const y = entry.y ?? cursorY - size;
    const x = entry.x ?? MARGIN;

    if (entry.runs) {
      // Several pieces of text, drawn one after another with no gap between
      // them - exactly how an invoice number gets broken into two runs.
      let cursorX = x;
      for (const piece of entry.runs) {
        page.drawText(piece, { x: cursorX, y, size, font, color });
        cursorX += font.widthOfTextAtSize(piece, size);
      }
    } else if (entry.columns) {
      // A table row: each cell drawn at its own column position.
      entry.columns.forEach((cell, position) => {
        page.drawText(cell, {
          x: MARGIN + position * (entry.columnWidth ?? 130),
          y,
          size,
          font,
          color,
        });
      });
    } else if (entry.text) {
      page.drawText(entry.text, { x, y, size, font, color });
    }

    if (entry.y === undefined) cursorY = y - (entry.gap ?? 6);
  }

  return page;
}

/** The masthead every made-up invoice starts with. */
function letterhead(company, address) {
  return [
    line(company, { size: 18, bold: true, gap: 4 }),
    line(address, { size: 9, faint: true, gap: 18 }),
  ];
}

/** A few plausible line items, so the fixtures look like invoices. */
function lineItems(items) {
  const rows = [
    { columns: ['Description', 'Qty', 'Unit', 'Amount'], bold: true, size: 9, gap: 10 },
    ...items.map((item) => ({ columns: item, size: 9, gap: 8 })),
  ];
  return rows;
}

function totals(amount) {
  return [line(`Total due  ${amount}`, { size: 11, bold: true, gap: 4 })];
}

/**
 * A page whose "Invoice #" is a column heading, with the number printed in the
 * row underneath rather than beside it.
 *
 * The letterhead runs down the far left at those same two heights, so read as
 * lines the heading row is "3RD FLOOR Date Invoice #" and the row under it
 * starts with the company's own postcode. Reading order alone cannot tell that
 * postcode from the invoice number; the column the heading stands over can.
 */
function columnHeadingPage(number, date) {
  return [
    line('Anchor Textile Group', { size: 12, bold: true, y: 743, x: MARGIN }),
    line('Invoice', { size: 15, bold: true, y: 734, x: 500 }),
    line('88 Weaver Street', { size: 12, faint: true, y: 721, x: MARGIN }),
    line('3RD FLOOR', { size: 12, faint: true, y: 707, x: MARGIN }),
    line('Date', { size: 8, bold: true, y: 710, x: 463 }),
    line('Invoice #', { size: 8, bold: true, y: 710, x: 522 }),
    line('SPRINGFIELD, IL 62704', { size: 12, faint: true, y: 692, x: MARGIN }),
    line(date, { size: 8, y: 688, x: 454 }),
    line(number, { size: 8, y: 688, x: 517 }),
    line('Bill To', { size: 8, bold: true, y: 640, x: MARGIN }),
    line('Lantern Apparel Co.', { size: 9, y: 626, x: MARGIN }),
    line('914 Foundry Road, Akron, OH 44311', { size: 9, y: 614, x: MARGIN }),
    line('Description', { size: 8, bold: true, y: 560, x: MARGIN }),
    line('Qty', { size: 8, bold: true, y: 560, x: 330 }),
    line('Amount', { size: 8, bold: true, y: 560, x: 440 }),
    line('Brushed cotton overshirt', { size: 9, y: 544, x: MARGIN }),
    line('42', { size: 9, y: 544, x: 330 }),
    line('3,780.00', { size: 9, y: 544, x: 440 }),
    line('Total', { size: 10, bold: true, y: 500, x: 380 }),
    line('3,780.00', { size: 10, bold: true, y: 500, x: 440 }),
  ];
}

/**
 * A page from a client whose invoice number sits under a heading nothing
 * recognises, so only a saved spot can find it.
 *
 * The first page of each invoice prints the number in that spot. A continuation
 * page prints a subtotal carried over from the page before in exactly the same
 * place - the thing a spot has to ignore, or every continuation page would
 * start an invoice of its own.
 */
function boxedNumberPage({ number = '', continuation = false }) {
  return [
    line('Harbor & Pine Apparel', { size: 14, bold: true, y: 740, x: MARGIN }),
    line('7 Quayside Lane, Kingsbridge TQ7 1HT', { size: 9, faint: true, y: 726, x: MARGIN }),
    line(continuation ? 'FACTURE (SUITE)' : 'FACTURE', { size: 13, bold: true, y: 700, x: MARGIN }),
    line(continuation ? 'Report' : 'N° pièce', { size: 8, bold: true, y: 700, x: 430 }),
    line(continuation ? '1,472.00' : number, { size: 9, y: 686, x: 430 }),
    line('Date', { size: 8, bold: true, y: 700, x: 520 }),
    line('03/04/26', { size: 9, y: 686, x: 520 }),
    line('Description', { size: 8, bold: true, y: 600, x: MARGIN }),
    line('Qty', { size: 8, bold: true, y: 600, x: 330 }),
    line('Amount', { size: 8, bold: true, y: 600, x: 440 }),
    line(continuation ? 'Linen overshirt' : 'Merino crew knit', { size: 9, y: 584, x: MARGIN }),
    line(continuation ? '18' : '24', { size: 9, y: 584, x: 330 }),
    line(continuation ? '1,512.00' : '2,944.00', { size: 9, y: 584, x: 440 }),
  ];
}

/** Save one PDF built from a list of page descriptions. */
async function writePdf(name, pages) {
  const pdf = await PDFDocument.create();
  const fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
  };
  pdf.setTitle(name);
  pdf.setCreator('Invoice Splitter fixture generator (synthetic data)');
  for (const pageLines of pages) drawPage(pdf, fonts, pageLines);
  const bytes = await pdf.save();
  await writeFile(join(FIXTURE_DIR, name), bytes);
  return name;
}

/* -------------------------------------------------------------------------- */
/* The fixtures                                                               */
/* -------------------------------------------------------------------------- */

/** A4, in points, and in pixels at 300 dpi. */
const A4_WIDTH = 595;
const A4_HEIGHT = 842;
const SCAN_WIDTH = 2480;
const SCAN_HEIGHT = 3508;

/** Dot size for the scanned sheets: small print, about 6.5 points a letter. */
const SCAN_DOT = 3;

/** Where the invoice number sits on a scanned sheet, in pixels from the top left. */
export const SCANNED_NUMBER_AT = { x: 1824, y: 700 };

/**
 * The sheets of fixture 23. Every name, address and number is invented, and
 * the ledger letters are ones the dot font reads cleanly after a slash.
 */
const SCANNED_SHEETS = [
  { label: 'INVOICE NR.', number: '2031/TB/00412', sheet: 1, body: ['LINEN SHIRT 12 1,264.00'] },
  { label: 'INVOICE NR.', number: '2031/TB/00412', sheet: 2, body: ['WOOL SCARF 6 540.00'] },
  {
    label: 'CRED. NOTE NR.',
    number: '2031/TB/00587',
    sheet: 1,
    body: ['REF. INVOICE 2031/TB/00412', 'LINEN SHIRT 2 118.00'],
  },
];

/**
 * The sheets of fixture 24: order pages printed from a web shop's admin screen
 * and scanned, with the scanner's own reading of them laid over the picture as
 * invisible text. Every name and number is invented.
 */
const PRINTOUT_SHEETS = [
  { order: '7730051-1107', time: '10:12', day: 19, sheet: '1/2' },
  { order: '7730051-1107', time: '10:12', sheet: '2/2' },
  { order: '9902114705-0031', time: '10:05', day: 16, sheet: '1/1' },
  { order: '7730051-1103', time: '10:09', day: 19, sheet: '1/2' },
  { order: '7730051-1103', time: '10:09', sheet: '2/2' },
];

/** Where the PO number sits on a printout's first page, in points from the bottom left. */
export const PRINTOUT_PO_AT = { x: 400, y: 606 };

/** The lines of one printout page, as [text, x, y] in points. */
function printoutLines({ order, time, day, sheet }) {
  const header = [`9/12/31, ${time} AM Tidewater Goods - Orders - ${order} - Storefront`, 30, 770];
  const footer = [`https://admin.example.com/store/tidewater/orders ${sheet}`, 30, 30];
  if (!day) {
    return [
      header,
      ['Pink / M TW5530-M', 60, 740],
      ['Paid', 40, 720],
      ['Subtotal 9 items $604.80', 40, 700],
      ['Metafields', 40, 680],
      footer,
    ];
  }
  return [
    header,
    ['Paid Fulfilled', 100, 740],
    ['Notes', 400, 740],
    [`${order.slice(0, 9)}... Archived`, 40, 720],
    ['No notes from customer', 400, 700],
    [`March ${day}, 2031 at 9:14 am from Linkline: Wholesale EDI for`, 40, 680],
    ['retailers (by feed)', 40, 666],
    ['Additional details', 400, 640],
    ['PO Number', 400, 620],
    [order, PRINTOUT_PO_AT.x, PRINTOUT_PO_AT.y],
    ['Linen Overshirt $44.00 x 1 $44.00', 40, 580],
    footer,
  ];
}

/**
 * The invoices of fixture 25, each followed by the same page of terms. Every
 * name and number is invented.
 */
const TERMS_SHEETS = [
  { number: 'SI-7710001', customer: 'TIDEWATER BOUTIQUE LLC', po: 'TWB2201' },
  { number: 'SI-7710002', customer: 'TIDEWATER BOUTIQUE LLC', po: 'TWB2201' },
  { number: 'SI-7710015', customer: 'KESTREL AND FINCH INC', po: 'KF-8812' },
  { number: 'SI-7710021', customer: 'NORTHGATE STORES LTD', po: 'NG55107', vat: 'GB123456789' },
];

/** One landscape invoice of fixture 25: the number under an "Invoice" title. */
function drawTermsInvoice(page, fonts, { number, customer, po, vat = 'IT00999888777' }) {
  const text = (value, x, y, size = 6, bold = false) =>
    page.drawText(value, { x, y, size, font: bold ? fonts.bold : fonts.regular, color: INK });
  text('MARLOWE ATELIER', 40, 531, 9, true);
  text(`VAT #: ${vat}`, 420, 531, 7, true);
  text('Invoice', 694, 531, 12, true);
  text('14 Quayside Walk', 40, 521);
  text(number, 695, 521);
  text('Bristol, BS1 4QA', 40, 513);
  text('http://www.marlowe-atelier.example', 40, 497);
  text('Bill To', 60, 480, 6, true);
  text('Ship to', 560, 480, 6, true);
  text(`Customer PO: ${po}`, 640, 480);
  text(customer, 40, 470);
  text(customer, 560, 470);
  text('Style Description Colour Quantity WSP TOTAL', 40, 420, 6, true);
  text('MA-2201 LINEN OVERSHIRT NAVY 5 88.00 440.00', 40, 410);
  text('USD 440.00', 760, 330, 7, true);
}

/** The page of terms printed after every invoice of fixture 25, word for word. */
function drawTermsPage(page, fonts) {
  const lines = [
    'MARLOWE ATELIER LIMITED ("MAL")',
    'TERMS AND CONDITIONS OF SALE',
    'All sales are subject to these terms and those contained in any purchase order.',
    'Title to products passes to the buyer once MAL receives payment in full.',
    'The buyer shall pay interest on any sum overdue at 4% a year above base rate.',
  ];
  lines.forEach((value, row) =>
    page.drawText(value, { x: 50, y: 780 - row * 16, size: 9, font: fonts.regular, color: INK })
  );
}

/** Draw one scanned sheet: letterhead, customer, the number in its box, a line or two. */
function drawScannedSheet(canvas, { label, number, sheet, body }) {
  const write = (text, x, y) => drawBitmapText(canvas, text, { x, y, scale: SCAN_DOT, gray: 25 });
  write('VALLOMBROSA TESSUTI SPA', 150, 150);
  write('VIA DEI TELAI 14 40066 REGGELLO', 150, 210);
  write('SPETT. TIDEWATER BOUTIQUE LLC', 1300, 400);
  write('88 HARBOR ROAD, MYSTIC CT', 1300, 460);
  write('DOCUMENT AND NUMBER', 1500, 640);
  // The label is written so that the number starts exactly where the tests
  // expect it: the dot font is fixed-width, 9 dots a letter.
  const labelStart = SCANNED_NUMBER_AT.x - `${label} `.length * 9 * SCAN_DOT;
  write(`${label} ${number}`, labelStart, SCANNED_NUMBER_AT.y);
  write(`PAG ${sheet}`, 2250, SCANNED_NUMBER_AT.y);
  write('DESCRIPTION QTY AMOUNT', 150, 900);
  body.forEach((line, row) => write(line, 150, 960 + row * 60));
}

const FIXTURES = [
  /** 1. The everyday case: label and number on one line, and a second page
   * that carries no number of its own. */
  () =>
    writePdf('01-same-line.pdf', [
      [
        ...letterhead('Northwind Traders', '4100 Harbour Way, Portland, OR 97203'),
        line('Invoice #: 104233', { size: 12, bold: true, gap: 4 }),
        line('Invoice Date: 04/09/2026', { size: 10, gap: 16 }),
        ...lineItems([
          ['Blue crate, 40 L', '12', '18.00', '216.00'],
          ['Packing tape, box of 6', '4', '9.50', '38.00'],
        ]),
        line('Continued on page 2', { size: 9, faint: true }),
      ],
      [
        ...letterhead('Northwind Traders', '4100 Harbour Way, Portland, OR 97203'),
        line('Delivery notes', { size: 12, bold: true, gap: 12 }),
        line('Goods left at the loading bay. Signed for by the day supervisor.', { size: 10 }),
        ...totals('254.00'),
      ],
    ]),

  /** 2. A table header, with the values on the line below it. */
  () =>
    writePdf('02-table-header.pdf', [
      [
        ...letterhead('Contoso Supply Co.', '88 Quarry Road, Boise, ID 83702'),
        { columns: ['Invoice No.', 'Date', 'Terms'], bold: true, size: 10, gap: 6 },
        { columns: ['104501', '09/04/2026', 'Net 30'], size: 10, gap: 18 },
        ...lineItems([['Filing cabinet, 3 drawer', '2', '145.00', '290.00']]),
        ...totals('290.00'),
      ],
    ]),

  /** 3. One invoice, three pages, the number repeated on each of them. */
  () =>
    writePdf(
      '03-repeated-number.pdf',
      [1, 2, 3].map((pageNumber) => [
        ...letterhead('Fabrikam Freight', '2 Canal Street, Buffalo, NY 14203'),
        line('Invoice #: 100777', { size: 12, bold: true, gap: 4 }),
        line(`Sheet ${pageNumber} of 3`, { size: 9, faint: true, gap: 16 }),
        ...lineItems([[`Pallet movement, week ${pageNumber}`, '18', '42.00', '756.00']]),
      ])
    ),

  /** 4. An invoice followed by a remittance slip that carries no number. */
  () =>
    writePdf('04-remittance-slip.pdf', [
      [
        ...letterhead('Tailspin Toys', '19 Beacon Hill, Dover, DE 19901'),
        line('Invoice #: 100888', { size: 12, bold: true, gap: 16 }),
        ...lineItems([['Wooden train set', '30', '24.00', '720.00']]),
        ...totals('720.00'),
      ],
      [
        line('Remittance advice', { size: 14, bold: true, gap: 12 }),
        line('Please detach this slip and return it with your payment.', { size: 10, gap: 8 }),
        line('Make cheques payable to Tailspin Toys.', { size: 10, gap: 8 }),
        line('Account 00-11-22   Sort code 40-11-09', { size: 10 }),
      ],
    ]),

  /** 5. The same invoice number turning up again later in the batch. */
  () =>
    writePdf('05-repeat-later.pdf', [
      [
        ...letterhead('Wingtip Paper', '5 Mill Lane, Camden, NJ 08102'),
        line('Invoice No: INV-2001', { size: 12, bold: true, gap: 16 }),
        ...lineItems([['Copier paper, A4, box', '40', '31.00', '1240.00']]),
      ],
      [
        ...letterhead('Wingtip Paper', '5 Mill Lane, Camden, NJ 08102'),
        line('Invoice No: INV-2002', { size: 12, bold: true, gap: 16 }),
        ...lineItems([['Envelopes, C5, box', '25', '12.00', '300.00']]),
      ],
      [
        ...letterhead('Wingtip Paper', '5 Mill Lane, Camden, NJ 08102'),
        line('Invoice No: INV-2001', { size: 12, bold: true, gap: 4 }),
        line('Page 2 of 2', { size: 9, faint: true, gap: 16 }),
        ...totals('1240.00'),
      ],
    ]),

  /** 6. A number the PDF draws as two separate runs of text. */
  () =>
    writePdf('06-split-text-runs.pdf', [
      [
        ...letterhead('Adventure Works', '77 Ridge Road, Flagstaff, AZ 86001'),
        { text: '', runs: ['Invoice #: ', '7788', '12'], size: 12, bold: true, gap: 16 },
        ...lineItems([['Trail map, laminated', '200', '3.10', '620.00']]),
        ...totals('620.00'),
      ],
    ]),

  /** 7. The bare style: "INVOICE 445566", with a street address underneath. */
  () =>
    writePdf('07-bare-invoice.pdf', [
      [
        line('INVOICE 445566', { size: 16, bold: true, gap: 6 }),
        line('1234 Maple Street', { size: 10, gap: 4 }),
        line('Springfield, IL 62704', { size: 10, gap: 18 }),
        ...lineItems([['Site survey, half day', '1', '480.00', '480.00']]),
        ...totals('480.00'),
      ],
    ]),

  /** 8. An "INVOICE" title on its own, an address with a ZIP code below it,
   * and the real number further down the page. */
  () =>
    writePdf('08-title-and-address.pdf', [
      [
        line('INVOICE', { size: 22, bold: true, gap: 8 }),
        line('1234 Maple Street', { size: 10, gap: 4 }),
        line('Springfield, IL 62704', { size: 10, gap: 20 }),
        line('Litware Logistics', { size: 12, bold: true, gap: 6 }),
        line('Inv#: A-10045', { size: 11, gap: 4 }),
        line('Date: 09/04/2026', { size: 10, gap: 16 }),
        ...lineItems([['Overnight delivery', '9', '55.00', '495.00']]),
        ...totals('495.00'),
      ],
    ]),

  /** 9. A date printed before the number, on the same line. */
  () =>
    writePdf('09-date-before-number.pdf', [
      [
        ...letterhead('Proseware Industries', '600 Foundry Street, Akron, OH 44301'),
        line('Invoice Date: 09/04/26     Invoice No: 3344', { size: 11, bold: true, gap: 16 }),
        ...lineItems([['Bearing assembly', '16', '78.00', '1248.00']]),
        ...totals('1248.00'),
      ],
    ]),

  /** 10. "Bill No." rather than "Invoice No." */
  () =>
    writePdf('10-bill-no.pdf', [
      [
        ...letterhead('Coho Vineyard', '3 Orchard Row, Napa, CA 94558'),
        line('Bill No. 55667', { size: 12, bold: true, gap: 16 }),
        ...lineItems([['Case of table wine', '6', '96.00', '576.00']]),
        ...totals('576.00'),
      ],
    ]),

  /** 11. "Document Number" with the value on the line below. */
  () =>
    writePdf('11-document-number.pdf', [
      [
        ...letterhead('Trey Research', '410 Institute Way, Madison, WI 53703'),
        line('Document Number', { size: 10, bold: true, gap: 4 }),
        line('DN-90210', { size: 12, gap: 16 }),
        ...lineItems([['Panel study, wave 2', '1', '3400.00', '3400.00']]),
        ...totals('3400.00'),
      ],
    ]),

  /** 12. A label nothing recognises until the user teaches it. */
  () =>
    writePdf('12-unusual-label.pdf', [
      [
        ...letterhead('Lucerne Publishing', '12 Printers Court, Providence, RI 02903'),
        line('Our Ref 889900', { size: 12, bold: true, gap: 4 }),
        line('Your order of 09/01/2026', { size: 10, gap: 16 }),
        ...lineItems([['Perfect binding, 500 copies', '1', '1150.00', '1150.00']]),
        ...totals('1150.00'),
      ],
    ]),

  /** 13. A page where "Invoice Notes" must not be mistaken for a number. */
  () =>
    writePdf('13-invoice-notes.pdf', [
      [
        ...letterhead('Graphic Design Institute', '9 Studio Lane, Austin, TX 78701'),
        line('Invoice Notes: 100 units held back pending sign-off', { size: 10, gap: 8 }),
        line('Invoice #: 990011', { size: 12, bold: true, gap: 16 }),
        ...lineItems([['Brand guidelines, revision 3', '1', '2200.00', '2200.00']]),
        ...totals('2200.00'),
      ],
    ]),

  /** 14. Two clients in one file, each printing its number its own way. */
  () =>
    writePdf('14-two-clients.pdf', [
      [
        ...letterhead('Northwind Traders', '4100 Harbour Way, Portland, OR 97203'),
        line('Our Ref NW-5501', { size: 12, bold: true, gap: 4 }),
        line('Store #: 218', { size: 10, gap: 16 }),
        ...lineItems([['Crate hire, monthly', '30', '11.00', '330.00']]),
      ],
      [
        ...letterhead('Northwind Traders', '4100 Harbour Way, Portland, OR 97203'),
        line('Delivery schedule', { size: 12, bold: true, gap: 12 }),
        line('Two drops a week, Tuesdays and Fridays.', { size: 10 }),
      ],
      [
        ...letterhead('Contoso Supply Co.', '88 Quarry Road, Boise, ID 83702'),
        line('Statement Ref CS-7702', { size: 12, bold: true, gap: 4 }),
        line('Store #: 442', { size: 10, gap: 16 }),
        ...lineItems([['Shelving bay, steel', '8', '210.00', '1680.00']]),
      ],
    ]),

  /** 17. Pages that only a marker phrase can separate. */
  () =>
    writePdf('17-marker-pages.pdf', [
      [
        ...letterhead('Fourth Coffee', '1 Roastery Yard, Seattle, WA 98104'),
        line('Page 1 of 2', { size: 10, gap: 16 }),
        ...lineItems([['House blend, 1 kg', '20', '17.00', '340.00']]),
      ],
      [line('Page 2 of 2', { size: 10, gap: 16 }), ...totals('340.00')],
      [
        ...letterhead('Fourth Coffee', '1 Roastery Yard, Seattle, WA 98104'),
        line('Page 1 of 3', { size: 10, gap: 16 }),
        ...lineItems([['Decaf, 1 kg', '10', '19.00', '190.00']]),
      ],
      [line('Page 2 of 3', { size: 10, gap: 16 }), line('Delivered 09/05/2026', { size: 10 })],
      [line('Page 3 of 3', { size: 10, gap: 16 }), ...totals('190.00')],
    ]),

  /** 18. Two different numbers, after two different labels, on one page. */
  () =>
    writePdf('18-conflicting-numbers.pdf', [
      [
        ...letterhead('Alpine Ski House', '30 Summit Drive, Denver, CO 80202'),
        line('Invoice No: 1111', { size: 12, bold: true, gap: 6 }),
        line('Bill No: 2222', { size: 12, bold: true, gap: 16 }),
        ...lineItems([['Season pass, adult', '4', '399.00', '1596.00']]),
        ...totals('1596.00'),
      ],
    ]),

  /**
   * 19. A long batch: 210 invoices over 220 pages, which is past the point
   * where the invoice table stops drawing every row at once. The first ten
   * invoices run to two pages, the rest to one, so the page numbers and the
   * invoice numbers do not line up - as they never do in real life.
   */
  () => {
    const sheets = [];
    for (let invoice = 0; invoice < 210; invoice += 1) {
      const number = 200_000 + invoice;
      const pagesInInvoice = invoice < 10 ? 2 : 1;
      for (let sheet = 1; sheet <= pagesInInvoice; sheet += 1) {
        sheets.push([
          ...letterhead('Humongous Insurance', '1 Ledger Plaza, Hartford, CT 06103'),
          line(`Invoice #: ${number}`, { size: 12, bold: true, gap: 4 }),
          line(`Sheet ${sheet} of ${pagesInInvoice}`, { size: 9, faint: true, gap: 16 }),
          ...lineItems([['Policy administration', '1', '250.00', '250.00']]),
        ]);
      }
    }
    return writePdf('19-long-batch.pdf', sheets);
  },

  /**
   * 20. A form, filled in. The layout accounting software actually produces:
   * the blank form's wording is drawn first, all of it, and the values are
   * dropped into their boxes afterwards. On the page "Invoice No." and its
   * number sit side by side; in the file they are nowhere near each other.
   */
  () =>
    writePdf('20-form-layout.pdf', [
      [
        // Pass one: the form. Every label, in one go, exactly as a template
        // would lay them down.
        line('COMMERCIAL INVOICE', { size: 15, bold: true, y: 736, x: 200 }),
        line('Northwind Traders', { size: 13, bold: true, y: 740, x: MARGIN }),
        line('4100 Harbour Way, Portland, OR 97203', { size: 8, faint: true, y: 726, x: MARGIN }),
        line('INVOICE NO.', { size: 8, bold: true, y: 700, x: 380 }),
        line('DATE', { size: 8, bold: true, y: 680, x: 380 }),
        line('DUE DATE', { size: 8, bold: true, y: 664, x: 380 }),
        line('PAGE', { size: 8, bold: true, y: 648, x: 380 }),
        line('BILL TO:', { size: 8, bold: true, y: 610, x: MARGIN }),
        line('SHIP TO:', { size: 8, bold: true, y: 610, x: 300 }),
        line('ORDER #', { size: 8, bold: true, y: 540, x: MARGIN }),
        line('P.O. NUMBER', { size: 8, bold: true, y: 540, x: 150 }),
        line('TERMS', { size: 8, bold: true, y: 540, x: 280 }),
        line('SHIP VIA', { size: 8, bold: true, y: 540, x: 400 }),
        line('DESCRIPTION', { size: 8, bold: true, y: 480, x: MARGIN }),
        line('QTY', { size: 8, bold: true, y: 480, x: 330 }),
        line('UNIT PRICE', { size: 8, bold: true, y: 480, x: 400 }),
        line('TOTAL INVOICE', { size: 8, bold: true, y: 380, x: 380 }),

        // Pass two: what was typed into it.
        line('2071548', { size: 10, bold: true, y: 700, x: 470 }),
        line('03/04/26', { size: 9, y: 680, x: 470 }),
        line('04/18/26', { size: 9, y: 664, x: 470 }),
        line('1 of 1', { size: 9, y: 648, x: 470 }),
        line('Juniper Row Outfitters Ltd', { size: 9, y: 596, x: MARGIN }),
        line('82 Tamarack Crescent', { size: 9, y: 584, x: MARGIN }),
        line('Distribution Centre', { size: 9, y: 596, x: 300 }),
        line('82 Tamarack Crescent', { size: 9, y: 584, x: 300 }),
        line('5512086', { size: 9, y: 526, x: MARGIN }),
        line('7730415', { size: 9, y: 526, x: 150 }),
        line('NET 30 DAYS', { size: 9, y: 526, x: 280 }),
        line('GROUND', { size: 9, y: 526, x: 400 }),
        line('Canvas field boot, tan', { size: 9, y: 466, x: MARGIN }),
        line('96', { size: 9, y: 466, x: 330 }),
        line('84.00', { size: 9, y: 466, x: 400 }),
        line('8,064.00', { size: 10, bold: true, y: 380, x: 470 }),
      ],
    ]),

  /**
   * 21. A label that is a column heading, with its value in the row below.
   *
   * Two invoices, one page each, laid out the way accounting packages print
   * them: a narrow "Invoice #" column with the number underneath it. Whatever
   * else sits at that height belongs to another column and is not the value,
   * however early it comes in reading order.
   */
  () =>
    writePdf('21-column-heading.pdf', [
      // The numbers carry a suffix, the way accounting software prints a
      // revision or print count. It is part of the number, not a break in it.
      columnHeadingPage('SR-40881_2', '09/22/26'),
      columnHeadingPage('SR-40997_1', '09/23/26'),
    ]),

  /**
   * 22. Two invoices of two pages each, from a client only a saved spot can read.
   *
   * The number is under "N\u00b0 pi\u00e8ce", which no label tier knows, and each
   * continuation page has a subtotal in that same spot. Read from a spot that
   * remembers the shape of the number it was shown, the subtotal is passed
   * over and each continuation page stays with the invoice it continues.
   */
  () =>
    writePdf('22-boxed-number.pdf', [
      boxedNumberPage({ number: '50621' }),
      boxedNumberPage({ continuation: true }),
      boxedNumberPage({ number: '50698' }),
      boxedNumberPage({ continuation: true }),
    ]),

  /** 15. A file that cannot be opened without a password. */
  async () => {
    const name = '15-password-protected.pdf';
    await writeFile(
      join(FIXTURE_DIR, name),
      buildEncryptedPdf({
        userPassword: 'secret',
        lines: [
          { text: 'Blue Yonder Airlines', x: 56, y: 720, size: 16 },
          { text: 'Invoice #: 900100', x: 56, y: 690, size: 12 },
        ],
      })
    );
    return name;
  },

  /**
   * 23. Three scanned pages with a line of real text added on top of each.
   *
   * Every page is a picture of paper, but software has typed a customs note over
   * it, so each page has text - just none of it the invoice number. The numbers
   * run by year and ledger, with slashes, and the last page is a credit note
   * that mentions the invoice it credits. Made at 300 dpi, as an office scanner
   * leaves a page.
   */
  async () => {
    const name = '23-scanned-with-notes.pdf';
    const pdf = await PDFDocument.create();
    pdf.setTitle('Scanned invoices with a note typed on top (synthetic)');
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    for (const sheet of SCANNED_SHEETS) {
      const canvas = createCanvas(SCAN_WIDTH, SCAN_HEIGHT);
      drawScannedSheet(canvas, sheet);
      soften(canvas);
      const image = await pdf.embedPng(encodeGrayPng(canvas));
      const page = pdf.addPage([A4_WIDTH, A4_HEIGHT]);
      page.drawImage(image, { x: 0, y: 0, width: A4_WIDTH, height: A4_HEIGHT });
      page.drawText('CUSTOMS COPY - HS 6205.20', {
        x: 40,
        y: 40,
        size: 9,
        font,
        color: rgb(0.1, 0.2, 0.7),
      });
    }
    await writeFile(join(FIXTURE_DIR, name), await pdf.save());
    return name;
  },

  /**
   * 24. Order printouts, scanned, with the scanner's own reading laid over them.
   *
   * Each page is a picture of paper with invisible text on top, as a scanner
   * that makes searchable PDFs leaves it - so a box can be drawn on the text
   * that is there, with no reading needed. The first line is the time the page
   * was printed and its order number, so it is never the same twice; the order
   * numbers come in two lengths; and every order's second page has nothing where
   * the PO number goes.
   */
  async () => {
    const name = '24-scanned-with-own-text.pdf';
    const pdf = await PDFDocument.create();
    pdf.setTitle('Scanned order printouts with a text layer (synthetic)');
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const [width, height] = [PAGE_WIDTH, PAGE_HEIGHT];
    const pixels = 1275 / width;
    for (const sheet of PRINTOUT_SHEETS) {
      const lines = printoutLines(sheet);
      const canvas = createCanvas(1275, 1650);
      for (const [text, x, y] of lines) {
        drawBitmapText(canvas, text, {
          x: Math.round(x * pixels),
          y: Math.round((height - y - 9) * pixels),
          scale: 2,
          gray: 30,
        });
      }
      soften(canvas);
      const image = await pdf.embedPng(encodeGrayPng(canvas));
      const page = pdf.addPage([width, height]);
      page.drawImage(image, { x: 0, y: 0, width, height });
      for (const [text, x, y] of lines) {
        page.drawText(text, { x, y, size: 9, font, opacity: 0 });
      }
    }
    await writeFile(join(FIXTURE_DIR, name), await pdf.save());
    return name;
  },

  /**
   * 25. Landscape invoices to several customers, each followed by a page of terms.
   *
   * The number sits under a large "Invoice" title rather than after a label,
   * so only a box reads it. The bill-to block and the customer's PO change from
   * one customer to the next, the last invoice prints a different VAT number in
   * the letterhead, and the terms page is the same every time - so the client
   * has to be known by the letterhead alone, and the terms pages are pages to
   * keep with their invoice, not pages to ask about.
   */
  async () => {
    const name = '25-invoices-with-terms.pdf';
    const pdf = await PDFDocument.create();
    pdf.setTitle('Invoices with a page of terms after each (synthetic)');
    const fonts = {
      regular: await pdf.embedFont(StandardFonts.Helvetica),
      bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    };
    for (const sheet of TERMS_SHEETS) {
      drawTermsInvoice(pdf.addPage([842, 595]), fonts, sheet);
      drawTermsPage(pdf.addPage([595, 842]), fonts);
    }
    await writeFile(join(FIXTURE_DIR, name), await pdf.save());
    return name;
  },

  /** 16. A page that is only a picture, the way a scanner leaves it. */
  async () => {
    const name = '16-image-only.pdf';
    const canvas = createCanvas(1240, 1754); // A4 at about 150 dpi
    // One modest size throughout: text recognition is trained on ordinary body
    // text and reads a heading blown up twice as large markedly worse.
    drawBitmapText(canvas, 'SOUTHRIDGE VIDEO', { x: 80, y: 110, scale: 5, gray: 30 });
    drawBitmapText(canvas, 'INVOICE NO: 552211', { x: 80, y: 250, scale: 5, gray: 20 });
    drawBitmapText(canvas, 'DATE: 09/04/2026', { x: 80, y: 430, scale: 5, gray: 40 });
    drawBitmapText(canvas, 'CAMERA HIRE 3 DAYS', { x: 80, y: 540, scale: 5, gray: 40 });
    drawBitmapText(canvas, 'TOTAL DUE 1450.00', { x: 80, y: 650, scale: 5, gray: 30 });
    // A scanner never produces hard square pixels, and neither should this.
    soften(canvas);

    const pdf = await PDFDocument.create();
    pdf.setTitle('Scanned invoice (synthetic)');
    const image = await pdf.embedPng(encodeGrayPng(canvas));
    const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    page.drawImage(image, { x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT });
    await writeFile(join(FIXTURE_DIR, name), await pdf.save());
    return name;
  },
];

/* -------------------------------------------------------------------------- */
/* The harder scanned fixtures (26 onwards)                                   */
/* -------------------------------------------------------------------------- */

/** Made-up customers and line items, picked by position so they never change. */
const SCAN_CUSTOMERS = [
  ['Tidewater Boutique LLC', '88 Harbor Road, Mystic CT 06355'],
  ['Kestrel & Finch Inc.', '410 Grove Street, Albany NY 12207'],
  ['Northgate Stores Ltd', '2 Market Square, Dunmore DN4 7AA'],
];
const SCAN_ITEMS = [
  ['Linen overshirt, navy', '12', '1,264.00'],
  ['Wool scarf, oat', '6', '540.00'],
  ['Canvas tote, natural', '20', '380.00'],
];

/**
 * Draw one page of a scanned invoice onto a sheet at `dpi`.
 *
 * @param {object} fixture - its SCAN_SUITE entry.
 * @param {object} invoice - the invoice this page belongs to.
 * @param {number} sheetOf - which page of the invoice this is, from 1.
 * @param {number} position - which invoice of the fixture, from 0.
 */
function drawScanPage(fixture, invoice, sheetOf, position) {
  const dpi = fixture.dpi ?? 300;
  const scale = dpi / 72;
  const sheet = createSheet(
    Math.round(SHEET.width * scale),
    Math.round(SHEET.height * scale),
    fixture.paper
  );
  const ink = fixture.ink ?? [20, 20, 24];
  const strength = fixture.strength ?? 1;
  const put = (text, spot, extra = {}) =>
    writeText(sheet, text, {
      x: spot.x * scale,
      y: spot.y * scale,
      size: spot.size * scale,
      bold: spot.bold,
      colour: ink,
      strength,
      ...extra,
    });

  const first = sheetOf === 1;
  const [customer, customerAddress] = SCAN_CUSTOMERS[position % SCAN_CUSTOMERS.length];
  put(fixture.supplier, LAYOUT.supplier);
  put(fixture.address, LAYOUT.address);
  put(first ? 'INVOICE' : 'INVOICE (continued)', LAYOUT.title);
  if (first || invoice.numberOnEvery) {
    put('Invoice No:', LAYOUT.numberLabel);
    const slash = invoice.number.indexOf('/');
    if (fixture.numberGap && slash > 0) {
      // The year, then the rest a little further on, as some printers set it.
      const year = invoice.number.slice(0, slash);
      put(year, LAYOUT.number);
      put(invoice.number.slice(slash), {
        ...LAYOUT.number,
        x:
          LAYOUT.number.x +
          textWidth(year, LAYOUT.number.size) +
          fixture.numberGap * LAYOUT.number.size,
      });
    } else {
      put(invoice.number, LAYOUT.number);
    }
  }
  if (first) {
    put('Date:', LAYOUT.dateLabel);
    put(`0${(position % 9) + 1}/03/2031`, LAYOUT.date);
    put('Bill To:', LAYOUT.billTo);
    put(customer, LAYOUT.customer);
    put(customerAddress, LAYOUT.customerAddress);
  }

  const top = LAYOUT.tableTop;
  put('Description', { x: 56, y: top, size: 9, bold: true });
  put('Qty', { x: 330, y: top, size: 9, bold: true });
  put('Amount', { x: 470, y: top, size: 9, bold: true });
  drawRule(sheet, {
    x: 56 * scale,
    y: (top + 6) * scale,
    width: 480 * scale,
    weight: scale,
    colour: ink,
  });
  const [item, qty, amount] = SCAN_ITEMS[(position + sheetOf) % SCAN_ITEMS.length];
  put(item, { x: 56, y: top + 22, size: 10 });
  put(qty, { x: 330, y: top + 22, size: 10 });
  put(amount, { x: 470, y: top + 22, size: 10 });
  if (sheetOf === invoice.pages) {
    put('Total due', { x: 380, y: top + 100, size: 11, bold: true });
    put(amount, { x: 470, y: top + 100, size: 11, bold: true });
  }
  if (fixture.pageOf) put(`Page ${sheetOf} of ${invoice.pages}`, LAYOUT.footer);

  if (fixture.stamp && first) {
    // A rubber stamp laid across the date and the end of the number.
    const red = [196, 32, 44];
    const at = { x: 425 * scale, y: 150 * scale };
    const size = 26 * scale;
    drawFrame(sheet, {
      x: at.x - 8 * scale,
      y: at.y - size,
      width: textWidth('PAID', size, true) + 16 * scale,
      height: size + 10 * scale,
      weight: 3 * scale,
      colour: red,
      strength: 0.7,
      angle: -12,
    });
    writeText(sheet, 'PAID', {
      x: at.x,
      y: at.y,
      size,
      bold: true,
      colour: red,
      strength: 0.7,
      angle: -12,
    });
  }

  blur(sheet);
  return sheet;
}

/** Build one fixture of SCAN_SUITE: every page drawn, then made a picture in a PDF. */
async function writeScanFixture(fixture) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${fixture.what} (synthetic)`);
  let sheetNumber = 0;
  for (const [position, invoice] of fixture.invoices.entries()) {
    for (let sheetOf = 1; sheetOf <= invoice.pages; sheetOf += 1) {
      const sheet = drawScanPage(fixture, invoice, sheetOf, position);
      const angle = fixture.tilts?.[sheetNumber % fixture.tilts.length];
      if (angle) tilt(sheet, angle);
      if (fixture.specks)
        speckle(sheet, { specks: fixture.specks, seed: fixture.case * 100 + sheetNumber });
      const image = await pdf.embedPng(encodeRgbPng(sheet));
      const page = pdf.addPage([SHEET.width, SHEET.height]);
      page.drawImage(image, { x: 0, y: 0, width: SHEET.width, height: SHEET.height });
      sheetNumber += 1;
    }
  }
  await writeFile(join(FIXTURE_DIR, fixture.file), await pdf.save());
  return fixture.file;
}

FIXTURES.push(...SCAN_SUITE.map((fixture) => () => writeScanFixture(fixture)));

/**
 * Write every fixture. Safe to run again: it overwrites what is there.
 *
 * @returns {Promise<string[]>} the file names written.
 */
export async function makeFixtures() {
  await mkdir(FIXTURE_DIR, { recursive: true });
  const written = [];
  for (const build of FIXTURES) written.push(await build());
  return written.sort();
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const written = await makeFixtures();
  console.log(`Wrote ${written.length} sample PDFs to tests/fixtures/pdf:`);
  for (const name of written) console.log(`  ${name}`);
  console.log('\nEvery invoice in these files is made up.');
}
