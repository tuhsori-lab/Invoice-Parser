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

/** Shape of the file written by "Export profiles". */
export const PROFILE_FILE_KIND = 'invoice-splitter-profiles';
export const PROFILE_FILE_VERSION = 1;

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
 *   filenameTemplate: string, identifyingText: string[] }}
 */
export function createProfile(input = {}) {
  return {
    id: typeof input.id === 'string' && input.id ? input.id : nextId(),
    name: (input.name ?? '').trim() || 'Untitled client',
    labels: cleanList(input.labels),
    extraLabel: (input.extraLabel ?? '').trim(),
    filenameTemplate: (input.filenameTemplate ?? '').trim(),
    identifyingText: cleanList(input.identifyingText),
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

  const words = text.split(' ');
  // Anything at the end with a digit in it is the value, not the label.
  while (words.length > 0 && /\d/.test(words[words.length - 1])) words.pop();

  const label = words
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
