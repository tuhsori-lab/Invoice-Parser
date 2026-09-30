/**
 * What the app knows about a client's invoices.
 *
 * In the app a client is a box: where their invoice number sits on the page,
 * the shape of that number, and the first line of their page - usually the
 * letterhead - that says "this page is theirs". Recognising pages that way is
 * what lets one bulk file hold several clients, each read from their own box.
 *
 * The engine also accepts labels a client's number comes after, which the
 * detection tests use to exercise the label tier; the app itself only ever
 * draws boxes.
 *
 * Storing them is the app's job. This module only describes them and matches
 * them against page text.
 */

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

/**
 * The shape remembered alongside a spot, as valueShape in detect.js writes it:
 * runs like A4 or D5, and single separator characters, split by spaces.
 * Anything else is dropped rather than trusted.
 *
 * @param {*} value
 * @returns {string}
 */
function cleanShape(value) {
  if (typeof value !== 'string') return '';
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0 || parts.length > 24) return '';
  const valid = parts.every((part) => /^[AD]\d{1,3}$/.test(part) || /^[^A-Za-z0-9]$/.test(part));
  return valid ? parts.join(' ') : '';
}

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
 *   filenameTemplate: string, identifyingText: string[], zone: object|null,
 *   zoneShape: string }}
 */
export function createProfile(input = {}) {
  const zone = cleanZone(input.zone);
  return {
    id: typeof input.id === 'string' && input.id ? input.id : nextId(),
    name: (input.name ?? '').trim() || 'Untitled client',
    labels: cleanList(input.labels),
    extraLabel: (input.extraLabel ?? '').trim(),
    filenameTemplate: (input.filenameTemplate ?? '').trim(),
    identifyingText: cleanList(input.identifyingText),
    zone,
    // A shape only means something next to the spot it was taken from.
    zoneShape: zone ? cleanShape(input.zoneShape) : '',
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
 * @returns {Array<{ zone: object, name: string, shape: string }>}
 */
export function zonesForPage(text, profiles = []) {
  const matched = matchProfiles(text, profiles);
  const source = matched.length
    ? matched
    : profiles.filter((profile) => (profile?.identifyingText ?? []).length === 0);
  return source
    .filter((profile) => profile?.zone)
    .map((profile) => ({ zone: profile.zone, name: profile.name, shape: profile.zoneShape ?? '' }));
}
