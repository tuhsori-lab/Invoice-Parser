/**
 * Client profiles: recognising whose invoice a page is, and moving that
 * knowledge to another computer.
 */

import { describe, expect, it } from 'vitest';
import {
  createProfile,
  labelFromSelection,
  labelsForPage,
  matchProfiles,
  parseProfilesFile,
  PROFILE_FILE_KIND,
  serializeProfiles,
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

describe('teaching a label by highlighting it', () => {
  it('keeps the words and drops the number, because the number changes', () => {
    expect(labelFromSelection('Our Ref 889900')).toBe('Our Ref');
  });

  it('copes with a whole line being highlighted', () => {
    expect(labelFromSelection('  Invoice   No.   104501  ')).toBe('Invoice No');
  });

  it('keeps a hash, which is part of the label, but not a trailing colon', () => {
    expect(labelFromSelection('Invoice #: 104233')).toBe('Invoice #');
  });

  it('gives back nothing when only the number was highlighted', () => {
    expect(labelFromSelection('889900')).toBe('');
    expect(labelFromSelection('   ')).toBe('');
    expect(labelFromSelection()).toBe('');
  });

  it('leaves a label alone when no number was caught in the selection', () => {
    expect(labelFromSelection('Statement Ref')).toBe('Statement Ref');
  });

  it('keeps a highlight from running away with half the page', () => {
    expect(labelFromSelection('word '.repeat(40)).length).toBeLessThanOrEqual(60);
  });

  it('stops at the number even when more columns follow it on the line', () => {
    // Reported from a real invoice. The line runs three columns together, so a
    // highlight catches the label, its value, and the start of the next column.
    // The label is what comes before the number, not everything up to the last
    // word that happens to have a digit in it.
    expect(
      labelFromSelection('Our order + Ref 71402 SS27 REPEAT LOT 2 Ship.note: 7140')
    ).toBe('Our order + Ref');
  });

  it('is not fooled by a word with a digit sitting after the number', () => {
    expect(labelFromSelection('Invoice No 104501 Date 03/04/26')).toBe('Invoice No');
  });

  it('keeps a label whose own words are too short to be a number', () => {
    expect(labelFromSelection('Ref 1 No 889900')).toBe('Ref 1 No');
  });
});

describe('moving profiles to another computer', () => {
  it('writes a file that can be read back', () => {
    const contents = serializeProfiles([northwind, contoso]);
    const { profiles, error } = parseProfilesFile(contents);

    expect(error).toBeNull();
    expect(JSON.parse(contents).kind).toBe(PROFILE_FILE_KIND);
    expect(profiles.map((profile) => profile.name)).toEqual([
      'Northwind Traders',
      'Contoso Supply Co.',
    ]);
    expect(profiles[0].labels).toEqual(['Our Ref']);
    expect(profiles[0].extraLabel).toBe('Store #');
  });

  it('gives each imported profile a fresh id, so nothing is overwritten', () => {
    const { profiles } = parseProfilesFile(serializeProfiles([northwind]));

    expect(profiles[0].id).not.toBe(northwind.id);
  });

  it('accepts a plain list of profiles as well', () => {
    const { profiles, error } = parseProfilesFile('[{"name":"Fabrikam","labels":["Ref No"]}]');

    expect(error).toBeNull();
    expect(profiles[0].name).toBe('Fabrikam');
  });

  it('says plainly when the file is not a profiles file', () => {
    expect(parseProfilesFile('this is not json').error).toMatch(/not a profiles file/i);
    expect(parseProfilesFile('{"kind":"something else"}').error).toMatch(/no profiles in it/i);
    expect(parseProfilesFile('[]').error).toMatch(/no profiles in it/i);
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

  it('carries a spot to another computer and back', () => {
    const saved = [createProfile({ name: 'Anchor Textile Group', zone: spot })];
    const { profiles, error } = parseProfilesFile(serializeProfiles(saved));

    expect(error).toBeNull();
    expect(profiles[0].zone).toEqual(spot);
  });

  it('reads a spot only on the pages of the client it was pointed at', () => {
    const profiles = [
      createProfile({ name: 'Anchor', identifyingText: ['Anchor Textile'], zone: spot }),
      createProfile({ name: 'Lantern', identifyingText: ['Lantern Apparel'], zone: spot }),
    ];

    expect(zonesForPage('Anchor Textile Group, Springfield', profiles)).toEqual([
      { zone: spot, name: 'Anchor' },
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
      { zone: spot, name: 'Just this batch' },
    ]);
  });

  it('prefers the client that was recognised over one that recognises nothing', () => {
    const profiles = [
      createProfile({ name: 'Loose', zone: spot }),
      createProfile({ name: 'Anchor', identifyingText: ['Anchor Textile'], zone: spot }),
    ];

    expect(zonesForPage('Anchor Textile Group', profiles)).toEqual([
      { zone: spot, name: 'Anchor' },
    ]);
  });
});
