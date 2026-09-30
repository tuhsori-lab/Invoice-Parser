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
 * Text read from a scan is never quite the same twice: the same letterhead can
 * come out as "HARBOR & PINE" on one page, "HARB0R & PINE" on the next, and run
 * into the line beside it on a third - or go missing altogether. So a client
 * seen on a scan is known by up to three lines from the top of their page. On a
 * page read by text recognition, a line counts as there when most of its words
 * are, each allowed a letter wrong, and the client counts as there when most of
 * their lines are: one line alone - an address shared with a neighbour, say -
 * is not enough.
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
 * @param {boolean} tolerant - the page was read from a scan.
 * @returns {boolean}
 */
function appearsOn(haystack, line, tolerant) {
  if (haystack.includes(flatten(line))) return true;
  return tolerant && mostlyOn(haystack, line);
}

/**
 * Is this page one of this client's?
 *
 * Any of their lines, word for word, is enough. On a page read from a scan,
 * most of their lines turning up, give or take, is enough as well.
 */
function claims(profile, haystack, tolerant) {
  const lines = profile?.identifyingText ?? [];
  if (lines.some((line) => haystack.includes(flatten(line)))) return true;
  if (!tolerant || lines.length === 0) return false;
  const seen = lines.filter((line) => mostlyOn(haystack, line)).length;
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

/** How far down a scanned page to look for the lines that name the client. */
const LETTERHEAD_LINES = 8;

/** How many lines a client seen on a scan is known by. */
const IDENTIFYING_LINES = 3;

/** How many other pages to compare against when choosing them. */
const LETTERHEAD_SAMPLE = 40;

/** Could this line be a name or an address, rather than a logo read as letters? */
function looksLikeWords(line) {
  const letters = (line.match(/[A-Za-z]/g) ?? []).length;
  const words = line.split(/\s+/).filter((word) => /^[A-Za-z&'.,:-]{2,}$/.test(word));
  return letters >= 12 && words.length >= 2 && letters / line.replace(/\s/g, '').length >= 0.6;
}

/**
 * The lines that say whose page this is, for knowing their pages again.
 *
 * On an ordinary page that is the first line, nearly always the letterhead. On
 * a page read from a scan the first line is as likely to be a logo, read as a
 * string of nonsense that will never come out the same way twice, and any one
 * line can be missing from the next page's reading. So there it is the lines
 * near the top, made of real-looking words, that turn up on at least half of
 * the batch's other scanned pages - a client's name and address are on every
 * one of their pages, and a delivery address or an order number is not - up to
 * three of them, most often seen first.
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
  const first = lines.length ? [lines[0]] : [];
  if (!page?.ocr) return first;

  const candidates = lines.slice(0, LETTERHEAD_LINES).filter(looksLikeWords);
  if (candidates.length === 0) return first;

  const others = batch
    .filter((other) => other?.ocr && other.index !== page.index)
    .slice(0, LETTERHEAD_SAMPLE)
    .map((other) => flatten(other.text));

  const counted = candidates
    .map((line, position) => ({
      line,
      position,
      count: others.filter((haystack) => appearsOn(haystack, line, true)).length,
    }))
    .sort((a, b) => b.count - a.count || a.position - b.position);

  const enough = Math.max(1, Math.ceil(others.length / 2));
  const chosen = counted.filter((entry) => entry.count >= enough).slice(0, IDENTIFYING_LINES);
  return (chosen.length ? chosen : counted.slice(0, 1)).map((entry) => entry.line);
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
