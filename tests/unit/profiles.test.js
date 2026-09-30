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
    expect(JSON.stringify(profile)).not.toMatch(/\d{4}/);
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

  it('is content with one line printed exactly', () => {
    expect(matchProfiles('VALLOMBROSA TESSUTI SPA', [vallombrosa], { tolerant: true })).toEqual([
      vallombrosa,
    ]);
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

  it('leaves out the customer the page was addressed to', () => {
    expect(identifyingLinesFor(batch[0], batch)).not.toContain('Spett. TIDEWATER BOUTIQUE LLC');
  });

  it('falls back to its best guess when the batch has nothing to compare with', () => {
    expect(identifyingLinesFor(batch[0], [batch[0]])).toEqual(['Spett. TIDEWATER BOUTIQUE LLC']);
  });
});
