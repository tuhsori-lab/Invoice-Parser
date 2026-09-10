/**
 * Client profiles: recognising whose invoice a page is, and moving that
 * knowledge to another computer.
 */

import { describe, expect, it } from 'vitest';
import {
  createProfile,
  labelsForPage,
  matchProfiles,
  parseProfilesFile,
  PROFILE_FILE_KIND,
  serializeProfiles,
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
