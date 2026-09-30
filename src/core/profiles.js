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
 *
 * A client is known by up to three lines from the top of their page that turn
 * up on their other pages too, and a page is theirs when most of those lines are
 * on it: one line alone - an address shared with a neighbour, say - is not
 * enough. Not simply the first line, because the first line is not always the
 * same twice: a page printed from a browser starts with the time it was printed,
 * and a scan's first line is as likely to be its logo read as nonsense.
 *
 * A line counts as there when it is, word for word, or when all of its words
 * are, whatever stray marks a scanner put between them. Text read by this app's
 * own text recognition is never quite the same twice - "HARBOR & PINE" on one
 * page, "HARB0R & PINE" on the next, run into the line beside it on a third - so
 * there most of a line's words are enough, each allowed a letter wrong.
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

/** Share of a line's words that have to turn up on a scanned page. */
const MOSTLY = 0.6;

/** Words shorter than this say too little to count, one way or the other. */
const SHORTEST_WORD = 3;

/** Words at least this long may have one letter misread. */
const LONG_WORD = 5;

/**
 * Is `needle` somewhere in `haystack`, allowing a few characters to be wrong?
 *
 * The standard way to find a near match inside a longer text: the distance of
 * the best match ending at each point of the text, worked out one character at
 * a time. It costs the length of one times the length of the other, which is
 * nothing for one word against one page, and is why it is only used on pages
 * read from a scan.
 *
 * @param {string} haystack
 * @param {string} needle
 * @param {number} allowed - how many characters may be added, dropped or wrong.
 * @returns {boolean}
 */
export function nearlyIncludes(haystack, needle, allowed) {
  const length = needle.length;
  if (length === 0) return true;
  if (allowed <= 0) return haystack.includes(needle);
  let previous = new Int32Array(length + 1);
  let current = new Int32Array(length + 1);
  for (let at = 0; at <= length; at += 1) previous[at] = at;
  for (let position = 0; position < haystack.length; position += 1) {
    const letter = haystack[position];
    current[0] = 0;
    for (let at = 1; at <= length; at += 1) {
      const swapped = previous[at - 1] + (needle[at - 1] === letter ? 0 : 1);
      current[at] = Math.min(swapped, previous[at] + 1, current[at - 1] + 1);
    }
    if (current[length] <= allowed) return true;
    [previous, current] = [current, previous];
  }
  return false;
}

/** The words of a line worth looking for. */
function wordsOf(line) {
  return flatten(line)
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= SHORTEST_WORD);
}

/**
 * Are most of this line's words on this page, each give or take a letter?
 *
 * Word by word rather than the line as a whole, because recognition runs words
 * together and splits them apart as readily as it gets a letter wrong, and a
 * line read as "SEDE AMMINISTRATIVA£GPERATIVAVIAGORTESA" still has most of the
 * words of the line it was.
 */
function mostlyOn(haystack, line) {
  const words = wordsOf(line);
  if (words.length === 0) return false;
  let found = 0;
  for (const word of words) {
    if (
      haystack.includes(word) ||
      (word.length >= LONG_WORD && nearlyIncludes(haystack, word, 1))
    ) {
      found += 1;
    }
  }
  return found / words.length >= MOSTLY;
}

/**
 * Does this line appear on this page?
 *
 * @param {string} haystack - the flattened page text.
 * @param {string} line - a client's identifying line.
 * @param {boolean} tolerant - the page was read by this app's text recognition.
 * @returns {boolean}
 */
function appearsOn(haystack, line, tolerant) {
  if (haystack.includes(flatten(line))) return true;
  if (tolerant) return mostlyOn(haystack, line);
  const words = wordsOf(line);
  return words.length > 0 && words.every((word) => haystack.includes(word));
}

/**
 * Is this page one of this client's? Most of their lines have to be on it -
 * every one, for a client known by one line or two.
 */
function claims(profile, haystack, tolerant) {
  const lines = profile?.identifyingText ?? [];
  if (lines.length === 0) return false;
  const seen = lines.filter((line) => appearsOn(haystack, line, tolerant)).length;
  return seen > lines.length / 2;
}

/**
 * Which profiles claim this page, in the order the profiles are listed.
 *
 * @param {string} text - the page text.
 * @param {Array<object>} profiles
 * @param {object} [options]
 * @param {boolean} [options.tolerant] - the text was read from a scan, so allow
 *   a few characters of an identifying line to have been misread.
 * @returns {Array<object>} the profiles whose identifying text appears on the page.
 */
export function matchProfiles(text, profiles = [], options = {}) {
  const { tolerant = false } = options;
  const haystack = flatten(text);
  if (!haystack) return [];
  return profiles.filter((profile) => claims(profile, haystack, tolerant));
}

/** How far down a page to look for the lines that name the client. */
const LETTERHEAD_LINES = 8;

/** How many lines a client is known by. */
const IDENTIFYING_LINES = 3;

/** How many of the nearest other pages to compare against when choosing them. */
const LETTERHEAD_SAMPLE = 40;

/**
 * Could this line be a name or an address - rather than a logo read as letters,
 * or a line that is mostly a date, a time and an order number?
 */
function looksLikeWords(line) {
  const letters = (line.match(/[A-Za-z]/g) ?? []).length;
  const words = line.split(/\s+/).filter((word) => /^[A-Za-z&'.,:-]{2,}$/.test(word));
  return letters >= 12 && words.length >= 2 && letters / line.replace(/\s/g, '').length >= 0.6;
}

/**
 * The lines that say whose page this is, for knowing their pages again.
 *
 * The lines near the top of the page, made of real-looking words, that turn up
 * on at least one other page of the batch - up to three, top first. A client's
 * name, address and the headings their software prints are on every one of
 * their pages; the time a page was printed, an order number, or a logo read as
 * nonsense is on none of the others. With nothing to compare against, the
 * first line that looks like words stands alone.
 *
 * @param {object} page - the page the box was drawn on.
 * @param {Array<object>} [batch] - every page of the batch.
 * @returns {string[]}
 */
export function identifyingLinesFor(page, batch = []) {
  const lines = String(page?.text ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const candidates = lines.slice(0, LETTERHEAD_LINES).filter(looksLikeWords);
  if (candidates.length === 0) return lines.length ? [lines[0]] : [];

  // The nearest pages first: a client's pages usually sit together in a batch.
  const others = batch
    .filter((other) => other && other.index !== page.index && other.text)
    .sort((a, b) => Math.abs(a.index - page.index) - Math.abs(b.index - page.index))
    .slice(0, LETTERHEAD_SAMPLE)
    .map((other) => ({ haystack: flatten(other.text), tolerant: Boolean(page.ocr || other.ocr) }));

  const recurring = candidates.filter((line) =>
    others.some(({ haystack, tolerant }) => appearsOn(haystack, line, tolerant))
  );
  return (recurring.length ? recurring : candidates).slice(
    0,
    recurring.length ? IDENTIFYING_LINES : 1
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
 * @param {{ tolerant?: boolean }} [options] - as for matchProfiles.
 * @returns {{ labels: string[], matched: Array<object>, client: string }}
 */
export function labelsForPage(text, profiles = [], options = {}) {
  const matched = matchProfiles(text, profiles, options);
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
 * @param {{ tolerant?: boolean }} [options] - as for matchProfiles.
 * @returns {Array<{ zone: object, name: string, shape: string }>}
 */
export function zonesForPage(text, profiles = [], options = {}) {
  const matched = matchProfiles(text, profiles, options);
  const source = matched.length
    ? matched
    : profiles.filter((profile) => (profile?.identifyingText ?? []).length === 0);
  return source
    .filter((profile) => profile?.zone)
    .map((profile) => ({ zone: profile.zone, name: profile.name, shape: profile.zoneShape ?? '' }));
}
