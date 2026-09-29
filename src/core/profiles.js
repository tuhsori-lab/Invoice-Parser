/**
 * Client profiles.
 *
 * A profile is one client's way of printing invoices: the labels their invoice
 * number comes after, an extra field worth putting in the file name, and some
 * identifying text (usually the client's company name) that says "this page is
 * theirs". Identifying text is what lets one bulk file hold several clients:
 * each page is matched to a profile on its own, and that profile's labels are
 * tried first for that page.
 *
 * Storing profiles is the app's job. This module only describes them, matches
 * them against page text, and reads and writes the file used to move them
 * between computers.
 */

import { looksLikeValue } from './detect.js';

/** Shape of the file written by "Export profiles". */
export const PROFILE_FILE_KIND = 'invoice-splitter-profiles';
export const PROFILE_FILE_VERSION = 1;

/**
 * A spot on a page, remembered so it can be found again on the next invoice.
 *
 * Kept as fractions of the page's width and height rather than as points, so a
 * spot pointed at on one invoice means the same spot on the next even when the
 * two pages are not the same size. `y` runs from the bottom of the page, which
 * is the direction PDFs themselves measure in.
 *
 * @param {object} [value]
 * @returns {{ x0: number, y0: number, x1: number, y1: number }|null}
 */
function cleanZone(value) {
  if (!value || typeof value !== 'object') return null;
  const numbers = ['x0', 'y0', 'x1', 'y1'].map((key) => Number(value[key]));
  if (numbers.some((number) => !Number.isFinite(number))) return null;

  const clamp = (number) => Math.min(1, Math.max(0, number));
  const [x0, y0, x1, y1] = numbers.map(clamp);
  const zone = {
    x0: Math.min(x0, x1),
    y0: Math.min(y0, y1),
    x1: Math.max(x0, x1),
    y1: Math.max(y0, y1),
  };
  // A spot with no width or no height was a click, not a highlight.
  if (zone.x1 <= zone.x0 || zone.y1 <= zone.y0) return null;
  return zone;
}

/** Longest label worth keeping from a highlight. */
const MAX_LABEL_LENGTH = 60;

let idCounter = 0;

/** A short, unique id for a profile. */
function nextId() {
  idCounter += 1;
  return `profile-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

/** Keep only non-empty strings, trimmed, in the order given. */
function cleanList(value) {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  const seen = new Set();
  const out = [];
  for (const entry of list) {
    if (typeof entry !== 'string') continue;
    const trimmed = entry.trim().replace(/\s+/g, ' ');
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

/**
 * Build a complete profile from whatever the caller has.
 *
 * @param {object} [input]
 * @returns {{ id: string, name: string, labels: string[], extraLabel: string,
 *   filenameTemplate: string, identifyingText: string[], zone: object|null }}
 */
export function createProfile(input = {}) {
  return {
    id: typeof input.id === 'string' && input.id ? input.id : nextId(),
    name: (input.name ?? '').trim() || 'Untitled client',
    labels: cleanList(input.labels),
    extraLabel: (input.extraLabel ?? '').trim(),
    filenameTemplate: (input.filenameTemplate ?? '').trim(),
    identifyingText: cleanList(input.identifyingText),
    zone: cleanZone(input.zone),
  };
}

/** Page text, flattened so a phrase split across two lines still matches. */
function flatten(text) {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * Which profiles claim this page, in the order the profiles are listed.
 *
 * @param {string} text - the page text.
 * @param {Array<object>} profiles
 * @returns {Array<object>} the profiles whose identifying text appears on the page.
 */
export function matchProfiles(text, profiles = []) {
  const haystack = flatten(text);
  if (!haystack) return [];
  return profiles.filter((profile) =>
    (profile?.identifyingText ?? []).some((needle) => haystack.includes(flatten(needle)))
  );
}

/**
 * The labels to try for one page, best first.
 *
 * Labels from profiles that recognised the page come first. Labels from the
 * other active profiles follow, because a profile without identifying text is
 * still worth trying.
 *
 * @param {string} text
 * @param {Array<object>} profiles - the active profiles, in the user's order.
 * @returns {{ labels: string[], matched: Array<object>, client: string }}
 */
export function labelsForPage(text, profiles = []) {
  const matched = matchProfiles(text, profiles);
  const matchedIds = new Set(matched.map((profile) => profile.id));
  const rest = profiles.filter((profile) => !matchedIds.has(profile.id));
  const labels = cleanList([
    ...matched.flatMap((profile) => profile.labels ?? []),
    ...rest.flatMap((profile) => profile.labels ?? []),
  ]);
  return { labels, matched, client: matched[0]?.name ?? '' };
}

/**
 * The remembered spots to read on one page.
 *
 * A spot is only meaningful on the client it was pointed at, so normally only
 * profiles that recognised the page contribute one. A profile with no
 * identifying text can never recognise anything, so when nothing recognised the
 * page those profiles' spots are used instead: somebody who saved a spot
 * without saying how to spot the client meant it to apply to what they are
 * looking at.
 *
 * @param {string} text
 * @param {Array<object>} profiles - the active profiles, in the user's order.
 * @returns {Array<{ zone: object, name: string }>}
 */
export function zonesForPage(text, profiles = []) {
  const matched = matchProfiles(text, profiles);
  const source = matched.length
    ? matched
    : profiles.filter((profile) => (profile?.identifyingText ?? []).length === 0);
  return source
    .filter((profile) => profile?.zone)
    .map((profile) => ({ zone: profile.zone, name: profile.name }));
}

/**
 * The profile that should decide an invoice's file name and extra field.
 *
 * @param {Array<object>} profiles - profiles matched by the pages of one invoice.
 * @returns {object|null}
 */
export function leadProfile(profiles = []) {
  return profiles.find(Boolean) ?? null;
}

/**
 * Turn a phrase somebody highlighted on a page into a label.
 *
 * People highlight what they see, which is usually the label *and* the number:
 * "Our Ref 889900". The number is the part that changes from invoice to
 * invoice, so it is dropped and only the words before it are kept.
 *
 * @param {string} selection - the text the user dragged across.
 * @returns {string} a label, or an empty string if there was nothing usable.
 */
export function labelFromSelection(selection) {
  const text = String(selection ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';

  // Everything from the first number-shaped word onwards is the value, not the
  // label. Trimming digits off the end instead stops at the first word without
  // one, and on a line that runs several columns together - "N° order +
  // Reference 50621 US FW26 CARRY OVER PART 1 Deliver.env: 5062" - that leaves
  // the whole line as the label. Cutting at the number leaves "N° order +
  // Reference", which is what was pointed at.
  const words = text.split(' ');
  const valueAt = words.findIndex((word) => {
    const [token] = /[A-Za-z0-9][A-Za-z0-9_-]*/.exec(word) ?? [];
    return token ? looksLikeValue(token) : false;
  });

  const label = (valueAt === -1 ? words : words.slice(0, valueAt))
    .join(' ')
    .replace(/[\s:.,;]+$/, '')
    .trim();

  // A label made only of punctuation would match everywhere and mean nothing.
  if (!/[A-Za-z]/.test(label)) return '';
  return label.slice(0, MAX_LABEL_LENGTH);
}

/**
 * The text of a profiles file, ready to be saved.
 *
 * @param {Array<object>} profiles
 * @returns {string}
 */
export function serializeProfiles(profiles = []) {
  return `${JSON.stringify(
    {
      kind: PROFILE_FILE_KIND,
      version: PROFILE_FILE_VERSION,
      exportedAt: new Date().toISOString(),
      profiles: profiles.map((profile) => ({
        name: profile.name,
        labels: profile.labels ?? [],
        extraLabel: profile.extraLabel ?? '',
        filenameTemplate: profile.filenameTemplate ?? '',
        identifyingText: profile.identifyingText ?? [],
        zone: profile.zone ?? null,
      })),
    },
    null,
    2
  )}\n`;
}

/**
 * Read a profiles file, explaining in plain language what is wrong if it cannot
 * be read.
 *
 * @param {string} contents
 * @returns {{ profiles: Array<object>, error: string|null }}
 */
export function parseProfilesFile(contents) {
  let data;
  try {
    data = JSON.parse(contents);
  } catch {
    return {
      profiles: [],
      error: 'This file is not a profiles file. Choose the .json file saved by "Export profiles".',
    };
  }
  const list = Array.isArray(data) ? data : data?.profiles;
  if (!Array.isArray(list)) {
    return {
      profiles: [],
      error: 'This file has no profiles in it. Choose the .json file saved by "Export profiles".',
    };
  }
  const profiles = list
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => createProfile({ ...entry, id: undefined }));
  if (profiles.length === 0) {
    return { profiles: [], error: 'This file has no profiles in it.' };
  }
  return { profiles, error: null };
}
