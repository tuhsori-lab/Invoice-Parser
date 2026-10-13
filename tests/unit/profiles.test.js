/**
 * Client profiles: recognising whose invoice a page is, and moving that
 * knowledge to another computer.
 */

import { describe, expect, it } from 'vitest';
import {
  createProfile,
  identifyingLinesFor,
  labelsForPage,
  matchProfiles,
  nearlyIncludes,
  zonesForPage,
} from '../../src/core/profiles.js';

const northwind = createProfile({
  name: 'Northwind Traders',
  labels: ['Our Ref'],
  extraLabel: 'Store #',
  identifyingText: ['Northwind Traders'],
});

const contoso = createProfile({
  name: 'Contoso Supply Co.',
  labels: ['Statement Ref'],
  identifyingText: ['Contoso Supply Co.'],
});

describe('making a profile', () => {
  it('fills in everything a profile needs', () => {
    const profile = createProfile({ name: '  Fabrikam  ' });

    expect(profile).toMatchObject({
      name: 'Fabrikam',
      labels: [],
      extraLabel: '',
      identifyingText: [],
    });
    expect(profile.id).toBeTruthy();
  });

  it('gives an unnamed profile something to be called', () => {
    expect(createProfile().name).toBe('Untitled client');
  });

  it('tidies the labels and drops repeats', () => {
    const profile = createProfile({ labels: ['  Our   Ref ', 'our ref', '', 'Ref No'] });

    expect(profile.labels).toEqual(['Our Ref', 'Ref No']);
  });
});

describe('recognising whose page this is', () => {
  it('matches a page by the client name printed on it', () => {
    const matched = matchProfiles('Northwind Traders\nOur Ref NW-5501', [northwind, contoso]);

    expect(matched.map((profile) => profile.name)).toEqual(['Northwind Traders']);
  });

  it('still matches when the name was split across two lines', () => {
    const matched = matchProfiles('Northwind\nTraders', [northwind]);

    expect(matched).toHaveLength(1);
  });

  it('does not mind capitals', () => {
    expect(matchProfiles('NORTHWIND TRADERS', [northwind])).toHaveLength(1);
  });

  it('matches nothing on a page it does not recognise', () => {
    expect(matchProfiles('Tailspin Toys', [northwind, contoso])).toEqual([]);
  });
});

describe('which labels to try for a page', () => {
  it('puts the labels of the profile that recognised the page first', () => {
    const { labels, client } = labelsForPage('Contoso Supply Co.', [northwind, contoso]);

    expect(labels).toEqual(['Statement Ref', 'Our Ref']);
    expect(client).toBe('Contoso Supply Co.');
  });

  it('still offers the other profiles labels, in case one of them fits', () => {
    const { labels, client } = labelsForPage('Someone else entirely', [northwind, contoso]);

    expect(labels).toEqual(['Our Ref', 'Statement Ref']);
    expect(client).toBe('');
  });

  it('gives back nothing when there are no profiles', () => {
    expect(labelsForPage('Anything', [])).toEqual({ labels: [], matched: [], client: '' });
  });
});

describe('remembering where the number sits', () => {
  const spot = { x0: 0.84, y0: 0.86, x1: 0.92, y1: 0.88 };

  it('keeps a spot the right way round however it was dragged', () => {
    // Dragged up and to the left, which is the same rectangle backwards.
    const profile = createProfile({ zone: { x0: 0.92, y0: 0.88, x1: 0.84, y1: 0.86 } });

    expect(profile.zone).toEqual(spot);
  });

  it('keeps a spot inside the page when the highlight ran off the edge', () => {
    const profile = createProfile({ zone: { x0: -0.2, y0: 0.5, x1: 1.4, y1: 0.6 } });

    expect(profile.zone).toEqual({ x0: 0, y0: 0.5, x1: 1, y1: 0.6 });
  });

  it('refuses a spot with no size, because that was a click not a highlight', () => {
    expect(createProfile({ zone: { x0: 0.5, y0: 0.2, x1: 0.5, y1: 0.3 } }).zone).toBeNull();
  });

  it('refuses a spot that is not a spot at all', () => {
    expect(createProfile({ zone: { x0: 'over there' } }).zone).toBeNull();
    expect(createProfile({ zone: 'over there' }).zone).toBeNull();
    expect(createProfile({}).zone).toBeNull();
  });

  it('reads a spot only on the pages of the client it was pointed at', () => {
    const profiles = [
      createProfile({ name: 'Anchor', identifyingText: ['Anchor Textile'], zone: spot }),
      createProfile({ name: 'Lantern', identifyingText: ['Lantern Apparel'], zone: spot }),
    ];

    expect(zonesForPage('Anchor Textile Group, Springfield', profiles)).toEqual([
      { zone: spot, name: 'Anchor', shape: '' },
    ]);
  });

  it('leaves out a client whose page this is but who has no spot', () => {
    const profiles = [createProfile({ name: 'Anchor', identifyingText: ['Anchor Textile'] })];

    expect(zonesForPage('Anchor Textile Group', profiles)).toEqual([]);
  });

  it('uses a spot saved without any way to recognise the client', () => {
    // Nothing can match such a profile, so a spot on it was meant for whatever
    // is in front of the person who saved it.
    const profiles = [createProfile({ name: 'Just this batch', zone: spot })];

    expect(zonesForPage('Some invoice or other', profiles)).toEqual([
      { zone: spot, name: 'Just this batch', shape: '' },
    ]);
  });

  it('prefers the client that was recognised over one that recognises nothing', () => {
    const profiles = [
      createProfile({ name: 'Loose', zone: spot }),
      createProfile({ name: 'Anchor', identifyingText: ['Anchor Textile'], zone: spot }),
    ];

    expect(zonesForPage('Anchor Textile Group', profiles)).toEqual([
      { zone: spot, name: 'Anchor', shape: '' },
    ]);
  });
});

describe('remembering what the number looks like', () => {
  const spot = { x0: 0.7, y0: 0.86, x1: 0.75, y1: 0.88 };

  it('keeps the shape of the number, never the number itself', () => {
    const profile = createProfile({ zone: spot, zoneShape: 'A4 D4 _ D1' });

    expect(profile.zoneShape).toBe('A4 D4 _ D1');
    // Everything but the box's own random id, which may happen to hold digits.
    const { id, ...kept } = profile;
    expect(id).toBeTruthy();
    expect(JSON.stringify(kept)).not.toMatch(/\d{4}/);
  });

  it('drops a shape that is not one', () => {
    expect(createProfile({ zone: spot, zoneShape: '50621' }).zoneShape).toBe('');
    expect(createProfile({ zone: spot, zoneShape: 'D5; alert(1)' }).zoneShape).toBe('');
    expect(createProfile({ zone: spot, zoneShape: 5 }).zoneShape).toBe('');
  });

  it('forgets the shape along with the spot', () => {
    expect(createProfile({ zone: null, zoneShape: 'D5' }).zoneShape).toBe('');
  });

  it('hands the shape over with the spot', () => {
    const profiles = [
      createProfile({ name: 'Harbor', identifyingText: ['Harbor'], zone: spot, zoneShape: 'D5' }),
    ];

    expect(zonesForPage('Harbor & Pine Apparel', profiles)).toEqual([
      { zone: spot, name: 'Harbor', shape: 'D5' },
    ]);
  });
});

describe('a client seen on a scan', () => {
  const vallombrosa = createProfile({
    name: 'Vallombrosa Tessuti SpA',
    identifyingText: ['VALLOMBROSA TESSUTI SPA', 'VIA DEI TELAI 14 50066 REGGELLO (FI) - Italy'],
    zone: { x0: 0.7, x1: 0.83, y0: 0.81, y1: 0.83 },
    zoneShape: 'D4 / A2 / D5',
  });

  it('finds a near match inside a longer text', () => {
    expect(nearlyIncludes('sede: via dei telal 14 reggello', 'telai', 1)).toBe(true);
    expect(nearlyIncludes('sede: via dei telal 14 reggello', 'telai', 0)).toBe(false);
    expect(nearlyIncludes('anything', '', 0)).toBe(true);
  });

  it('knows the client on a scan despite a misread letter or two', () => {
    const scanned = 'VALL0MBROSA TESSUTI SPA\nVIA DEI TELAl 14 50066 REGGELL0 (FI) - ltaly';

    expect(matchProfiles(scanned, [vallombrosa], { tolerant: true })).toEqual([vallombrosa]);
  });

  it('knows the client when recognition ran the words of a line together', () => {
    const scanned = 'Vmbrs0 ,\nVIADEITELAI 14 50066 REGGELLO (FI) - aly\nVALLOMBROSATESSUTISPA';

    expect(matchProfiles(scanned, [vallombrosa], { tolerant: true })).toEqual([vallombrosa]);
  });

  it('is strict on a typed page, where the text is exactly what was printed', () => {
    const typed = 'VALL0MBROSA TESSUTI SPA\nVIA DEI TELAl 14 50066 REGGELL0 (FI) - ltaly';

    expect(matchProfiles(typed, [vallombrosa])).toEqual([]);
  });

  it('does not take another client for this one because a few words are shared', () => {
    const other = 'LANIFICIO BELCORE SPA\nVIA DEL LAVORO 3 50066 REGGELLO (FI) - Italy';

    expect(matchProfiles(other, [vallombrosa], { tolerant: true })).toEqual([]);
  });

  it("needs most of the client's lines, not just one of them", () => {
    expect(matchProfiles('VALL0MBROSA TESSUTI SPA', [vallombrosa], { tolerant: true })).toEqual([]);
  });

  it('is content with the most widespread line, printed word for word', () => {
    expect(matchProfiles('VALLOMBROSA TESSUTI SPA', [vallombrosa], { tolerant: true })).toEqual([
      vallombrosa,
    ]);
  });

  it('needs most of the lines when the most widespread is only nearly there', () => {
    expect(matchProfiles('VALL0MBROSA TESSUTI SPA', [vallombrosa], { tolerant: true })).toEqual([]);
  });

  it('reads the box on a scanned page of that client', () => {
    const scanned = 'VALLOMBR0SA TESSUTI SPA\nVIA DEI TELAl 14 50066 REGGELLO (FI) - Italy';

    expect(zonesForPage(scanned, [vallombrosa], { tolerant: true })).toHaveLength(1);
    expect(zonesForPage(scanned, [vallombrosa])).toHaveLength(0);
  });
});

describe('choosing the lines a new client is known by', () => {
  const scan = (index, lines) => ({ index, ocr: true, text: lines.join('\n') });
  const batch = [
    scan(1, [
      'Vmbrs0 ,',
      'Spett. TIDEWATER BOUTIQUE LLC',
      'VALLOMBROSA TESSUTI SPA',
      'VIA DEI TELAI 14 50066 REGGELLO (FI) - Italy',
      '(00871) Invoice Nr. 2031/VT/00412',
    ]),
    scan(2, [
      'VmbrsO .',
      'Spett. TIDEWATER BOUTIQUE LLC',
      'VALLOMBROSA TESSUTI SPA',
      'VIA DEI TELAl 14 50066 REGGELLO (FI) - ltaly',
    ]),
    scan(3, [
      'Vnbrs0',
      'Spett. MARLOWE & FINCH INC',
      'VALL0MBROSA TESSUTI SPA',
      'VIA DEI TELAI 14 50066 REGGELL0 (FI) - Italy',
    ]),
    scan(4, ['Spett. MARLOWE & FINCH INC', 'VALLOMBROSA TESSUTI SPA']),
  ];

  it('takes the first line of a typed page, as it always has', () => {
    expect(identifyingLinesFor({ index: 9, ocr: false, text: 'Harbor & Pine\nInvoice 5' })).toEqual(
      ['Harbor & Pine']
    );
  });

  it('on a scan, takes the lines that turn up across the batch, not a logo read as letters', () => {
    expect(identifyingLinesFor(batch[0], batch)).toEqual([
      'VALLOMBROSA TESSUTI SPA',
      'VIA DEI TELAI 14 50066 REGGELLO (FI) - Italy',
    ]);
  });

  it('leaves out the customer, whose name only repeats on their own invoices', () => {
    expect(identifyingLinesFor(batch[0], batch)).not.toContain('Spett. TIDEWATER BOUTIQUE LLC');
  });

  it('still knows the client on a page addressed to another customer', () => {
    const client = createProfile({
      name: 'x',
      identifyingText: identifyingLinesFor(batch[0], batch),
    });

    expect(matchProfiles(batch[2].text, [client], { tolerant: true })).toEqual([client]);
  });

  it('falls back to its best guess when the batch has nothing to compare with', () => {
    expect(identifyingLinesFor(batch[0], [batch[0]])).toEqual(['Spett. TIDEWATER BOUTIQUE LLC']);
  });
});

describe('a client whose first line is never the same twice', () => {
  // Order pages printed from a web browser and scanned: the first line is the
  // time they were printed and the order number, and the scanner's own reading
  // puts stray marks where the page had icons. Everything here is invented.
  const printout = (index, { time, order, day, first = true }) => ({
    index,
    ocr: false,
    text: [
      `9/12/31, ${time} Tidewater Goods - Orders - ${order} - Storefront`,
      ...(first
        ? [
            '® Paid @ Fulfilled Notes',
            `${order.slice(0, 9)}... Archived`,
            'No notes from customer',
            `March ${day}, 2031 at 9:14 am from Linkline: Wholesale EDI for`,
            'retailers (by feed)',
            'Additional details',
            `PO Number ${order}`,
          ]
        : ['Pink / M TW5530-M', 'Paid', 'Subtotal 9 items $604.80', 'Metafields']),
    ].join('\n'),
  });
  const batch = [
    printout(1, { time: '10:12 AM', order: '7730051-1107', day: 19 }),
    printout(2, { time: '10:09 AM', order: '7730051-1103', day: 19 }),
    printout(3, { time: '10:05 AM', order: '4418200-0031', day: 16 }),
    printout(4, { time: '10:03 AM', order: '7729944-1107', day: 14 }),
    printout(5, { time: '10:03 AM', order: '7729944-1107', day: 14, first: false }),
  ];

  it('is not known by a line that is mostly a date, a time and an order number', () => {
    expect(identifyingLinesFor(batch[0], batch)).not.toContain(batch[0].text.split('\n')[0]);
  });

  it('is known by the lines its pages have in common', () => {
    expect(identifyingLinesFor(batch[0], batch)).toEqual([
      '® Paid @ Fulfilled Notes',
      'No notes from customer',
      'March 19, 2031 at 9:14 am from Linkline: Wholesale EDI for',
    ]);
  });

  it('knows every order of theirs from a box drawn on the first', () => {
    const client = createProfile({
      name: 'x',
      identifyingText: identifyingLinesFor(batch[0], batch),
    });

    expect(batch.map((page) => matchProfiles(page.text, [client]).length)).toEqual([1, 1, 1, 1, 0]);
  });

  it('counts a line as there when all its words are, whatever marks sit between them', () => {
    const client = createProfile({ name: 'x', identifyingText: ['® Paid @ Fulfilled Notes'] });

    expect(matchProfiles('@ Paid ® Fulfilled | Notes', [client])).toEqual([client]);
    expect(matchProfiles('Paid in full. Notes:', [client])).toEqual([]);
  });

  it('keeps the first line that looks like words when there is nothing to compare with', () => {
    expect(identifyingLinesFor(batch[0], [batch[0]])).toEqual(['® Paid @ Fulfilled Notes']);
  });

  it('still takes a letterhead as the first line, as it always has', () => {
    const typed = (index) => ({ index, text: `Lakeshore Office Supply\nInvoice No: 10${index}` });

    expect(identifyingLinesFor(typed(1), [typed(1), typed(2)])).toEqual([
      'Lakeshore Office Supply',
    ]);
  });
});

describe('a supplier who invoices many customers, with terms printed after every invoice', () => {
  // Everything here is invented. Each invoice is followed by a page of terms;
  // the bill-to block and the customer's order number change with the customer;
  // and a few invoices print a different VAT number in the letterhead.
  const invoice = (index, { number, customer, po, vat = 'IT00999888777' }) => ({
    index,
    ocr: false,
    text: [
      `MARLOWE ATELIER VAT #: ${vat} Invoice`,
      `14 Quayside Walk ${number}`,
      'Bristol, BS1 4QA',
      'http://www.marlowe-atelier.example',
      `Bill To Ship to Customer PO: ${po}`,
      `${customer} ${customer}`,
      'Department Selling Period Shipment Term Inv Date Order Date',
    ].join('\n'),
  });
  const terms = (index) => ({
    index,
    ocr: false,
    text: 'MARLOWE ATELIER LIMITED ("MAL")\nTERMS AND CONDITIONS OF SALE\nAll sales are subject to these terms.',
  });
  const customers = [
    { customer: 'TIDEWATER BOUTIQUE LLC', po: 'TWB2201' },
    { customer: 'TIDEWATER BOUTIQUE LLC', po: 'TWB2201' },
    { customer: 'KESTREL AND FINCH INC', po: 'KF-8812' },
    { customer: 'NORTHGATE STORES LTD', po: 'NG55107' },
    { customer: 'NORTHGATE STORES LTD', po: 'NG55107', vat: 'GB123456789' },
    { customer: 'HARBOR LANE GOODS', po: 'HL-3004', vat: 'GB123456789' },
  ];
  const batch = customers.flatMap((who, position) => [
    invoice(position * 2 + 1, { number: `SI-77100${position}`, ...who }),
    terms(position * 2 + 2),
  ]);
  const [first] = batch;

  it('is known by its letterhead, not by the first customer it invoiced', () => {
    const lines = identifyingLinesFor(first, batch, { leaveOut: 'SI-771000' });

    expect(lines[0]).toBe('MARLOWE ATELIER VAT #: IT00999888777 Invoice');
    expect(lines.join(' ')).not.toContain('TIDEWATER');
  });

  it('never keeps a line with the boxed invoice number in it', () => {
    expect(identifyingLinesFor(first, batch, { leaveOut: 'SI-771000' }).join(' ')).not.toContain(
      'SI-771000'
    );
  });

  it('knows every one of its invoices, whoever they are to, and none of the terms pages', () => {
    const client = createProfile({
      name: 'x',
      identifyingText: identifyingLinesFor(first, batch, { leaveOut: 'SI-771000' }),
    });

    expect(batch.map((page) => matchProfiles(page.text, [client]).length)).toEqual([
      1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0,
    ]);
  });

  it('lets one number in the letterhead change, but not the words around it', () => {
    const client = createProfile({
      name: 'x',
      identifyingText: ['MARLOWE ATELIER VAT #: IT00999888777 Invoice'],
    });

    expect(matchProfiles('MARLOWE ATELIER VAT # :GB123456789 Invoice', [client])).toEqual([client]);
    expect(matchProfiles('MARLOWE ATELIER VAT #: GB123456789 Credit', [client])).toEqual([]);
    expect(matchProfiles('LANTERN APPAREL VAT #: GB123456789 Invoice', [client])).toEqual([]);
  });
});
