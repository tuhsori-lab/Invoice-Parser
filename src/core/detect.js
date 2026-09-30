/**
 * Finding the invoice number on a page.
 *
 * Every client lays its invoices out differently, so there is no single rule
 * that works everywhere. Instead we try four tiers in a fixed order and stop at
 * the first hit. Which tier answered is reported back as `source`, and the exact
 * words the number was found after are reported as `label`, so the person using
 * the app can always see why a number was picked.
 *
 *   0. zone    - the spot on the page somebody pointed at for this client,
 *                which replaces the tiers below it when it finds anything
 *   1. profile - a label from one of this client's saved profiles
 *   2. common  - an everyday label such as "Invoice No." or "Bill #"
 *   3. bare    - the word "Invoice" followed by a number on the same line
 *   4. custom  - a regular expression the user typed, which replaces tiers 1-3
 *
 * This module is plain JavaScript: no framework, no PDF library, no browser
 * APIs. It takes page text in and gives a result out.
 */

/** How far past a label we look for the value, in characters. */
export const VALUE_SEARCH_WINDOW = 80;

/** Shortest run of characters that can be an invoice number. */
const MIN_VALUE_LENGTH = 3;

/** First half of a common label. Longer words first so labels read in full. */
const COMMON_FIRST_WORDS = [
  'credit\\s+memo',
  'debit\\s+memo',
  // "Credit Note No.", and the "Cred.Note N." of a European ledger.
  'cred(?:it)?\\.?\\s*note',
  'deb(?:it)?\\.?\\s*note',
  'invoice',
  'inv',
  'billing',
  'bill',
  'document',
  'doc',
];

/** Second half of a common label: "#", or a word that means "number". */
const COMMON_SECOND_WORDS = ['number', 'num', 'nbr', 'nr', 'no', 'id', 'ref'];

/**
 * "N°", "Nº" and "N." mean "number" too, on invoices printed in Europe. A bare
 * "N" does not count: it is too often just a letter.
 */
const SHORT_NUMBER_MARK = 'n(?:[°º]|\\.)';

/**
 * Spaces, or a single line break, between the words of a label.
 * Labels wrap across lines in table headers, so a line break has to be allowed,
 * but only one - otherwise a label swallows half the page.
 */
const LABEL_GAP = '[^\\S\\r\\n]*(?:\\r?\\n[^\\S\\r\\n]*)?';

/** Spaces and tabs only: used where a rule must not cross a line break. */
const SAME_LINE_SPACE = '[^\\S\\r\\n]*';

/** Periods, spaces and a colon are all optional decoration around a label. */
const LABEL_TAIL = `\\.?${LABEL_GAP}:?${LABEL_GAP}`;

/** A label may not start in the middle of a word ("Reinvoice No" is not a label). */
const NOT_AFTER_LETTER = '(?<![A-Za-z])';

/**
 * Runs of characters that could be a value.
 *
 * Hyphens and underscores are part of a number rather than a break in it:
 * plenty of accounting software prints a revision or print count as a suffix,
 * and "40017822_2" is the whole number, not "40017822" with something after it.
 * A slash between two characters is part of it as well, because a great deal of
 * European invoicing numbers by year and ledger: "2031/TB/00412" is one number.
 * A slash at either end is not. A value still has to start with a letter or a
 * digit.
 */
const TOKEN_SOURCE = '[A-Za-z0-9](?:[A-Za-z0-9_-]|/(?=[A-Za-z0-9]))*';
const TOKEN_PATTERN = new RegExp(TOKEN_SOURCE, 'g');

const MONTH_NAMES = 'jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec';

/** How many differently labelled values one pattern may report from one page. */
const MAX_HITS_PER_PATTERN = 4;

/** Escape a user-supplied label so it can be dropped into a regular expression. */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build the pattern for one label typed by a user.
 * Any whitespace inside the label matches any whitespace, including a line break.
 */
function labelPattern(label) {
  const words = String(label).trim().split(/\s+/).filter(Boolean).map(escapeRegExp);
  if (words.length === 0) return null;
  return `${NOT_AFTER_LETTER}${words.join(LABEL_GAP)}${LABEL_TAIL}`;
}

/** The one flexible pattern that covers everyday invoice number labels. */
export function commonLabelPattern() {
  const first = `(?:${COMMON_FIRST_WORDS.join('|')})`;
  const second = `(?:#|${SHORT_NUMBER_MARK}|(?:${COMMON_SECOND_WORDS.join('|')})\\b)`;
  return `${NOT_AFTER_LETTER}${first}\\.?${LABEL_GAP}${second}${LABEL_TAIL}`;
}

/** "Invoice" on its own, then a number, on the same line only. */
function bareInvoicePattern() {
  return `${NOT_AFTER_LETTER}invoice${SAME_LINE_SPACE}[:#-]?${SAME_LINE_SPACE}`;
}

/** Is this run of characters shaped like a date rather than an invoice number? */
export function isDateShaped(token) {
  return /^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}$/.test(token);
}

/** Blank out anything shaped like a date so it is never read as a value. */
function maskDates(window) {
  const blank = (match) => ' '.repeat(match.length);
  return window
    .replace(/\b\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}\b/g, blank)
    .replace(
      new RegExp(
        `\\b(?:${MONTH_NAMES})[a-z]*\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{2,4}\\b`,
        'gi'
      ),
      blank
    );
}

/** Tidy a raw value: upper case, no hyphen, underscore or slash left dangling. */
export function normalizeValue(token) {
  return String(token)
    .toUpperCase()
    .replace(/[-_/]+$/, '');
}

/**
 * Could this run of characters be an invoice number?
 *
 * Exported because teaching a label needs the same notion: the words a person
 * highlights in front of a number are the label, and this says where the number
 * starts.
 *
 * @param {string} token
 * @returns {boolean}
 */
export function looksLikeValue(token) {
  if (!/\d/.test(token)) return false;
  if (isDateShaped(token)) return false;
  // Only letters and digits count towards the length, so "1/2" - a page count -
  // is not long enough to be anybody's invoice number.
  return normalizeValue(token).replace(/[^A-Z0-9]/g, '').length >= MIN_VALUE_LENGTH;
}

/**
 * How far a value may sit outside its label's column and still belong to it.
 * A couple of points of slack covers a heading centred over its column, or a
 * value nudged by a hair; text in a different column is always further off.
 */
const COLUMN_SLACK = 4;

/**
 * Where a stretch of the page's text sat on the page.
 *
 * Positions are interpolated across each run, so that part of a run can be
 * placed as well as the whole of it - which is what makes the "62704" inside
 * "SPRINGFIELD, IL 62704" locatable on its own.
 *
 * @param {Array<object>} layout - the spans from extractText.js.
 * @param {number} start - first character of the stretch.
 * @param {number} end - one past its last character.
 * @returns {{ band: number, x0: number, x1: number }|null}
 */
function rangeOf(layout, start, end) {
  let band = null;
  let x0 = Infinity;
  let x1 = -Infinity;
  for (const span of layout) {
    if (span.end <= start || span.start >= end) continue;
    const length = span.end - span.start || 1;
    const width = span.endX - span.x;
    const from = Math.max(start, span.start);
    const to = Math.min(end, span.end);
    if (band === null) band = span.band;
    x0 = Math.min(x0, span.x + (width * (from - span.start)) / length);
    x1 = Math.max(x1, span.x + (width * (to - span.start)) / length);
  }
  return band === null ? null : { band, x0, x1 };
}

/**
 * Could the text at [start, end) be this label's value?
 *
 * On the label's own line, yes: reading order is the whole story there. On a
 * later line the label is a column heading, and only what stands in its column
 * belongs to it. Without that rule a company's own postcode, printed down the
 * far side of the page, is read as the invoice number - which is exactly what
 * happens on invoices that head a column "Invoice #" and print the number
 * underneath it.
 *
 * Pages with no layout - text recognised from a scan, or a plain string in a
 * test - keep the older, purely textual behaviour.
 *
 * @param {Array<object>|null} layout
 * @param {{ band: number, x0: number, x1: number }|null} label
 * @param {number} start
 * @param {number} end
 * @returns {boolean}
 */
function belongsToLabel(layout, label, start, end) {
  if (!layout || !label) return true;
  const value = rangeOf(layout, start, end);
  if (!value || value.band === label.band) return true;
  return value.x0 <= label.x1 + COLUMN_SLACK && value.x1 >= label.x0 - COLUMN_SLACK;
}

/**
 * Read the value that follows a label.
 *
 * Table layouts print `Invoice No.  Date  Terms` on one line and the values on
 * the next, so we look past words that are clearly headings ("Date", "Terms")
 * and take the first run of characters that contains a digit, is long enough,
 * and is not a date.
 *
 * A value on a later line has to stand in the label's own column, so that a
 * heading with its value printed underneath is read correctly and unrelated
 * text at the same height on the other side of the page is not.
 *
 * @param {string} text - the full page text.
 * @param {number} from - index just past the label.
 * @param {object} [options]
 * @param {Array<object>} [options.layout] - where each run sat on the page.
 * @param {number} [options.labelStart] - index of the label's first character.
 * @returns {string|null} the tidied value, or null if nothing usable was near.
 */
export function findValueAfterLabel(text, from, options = {}) {
  const { layout = null, labelStart = from } = options;
  const window = maskDates(String(text).slice(from, from + VALUE_SEARCH_WINDOW));
  const label = layout ? rangeOf(layout, labelStart, from) : null;
  TOKEN_PATTERN.lastIndex = 0;
  let match;
  while ((match = TOKEN_PATTERN.exec(window)) !== null) {
    const at = from + match.index;
    if (looksLikeValue(match[0]) && belongsToLabel(layout, label, at, at + match[0].length)) {
      TOKEN_PATTERN.lastIndex = 0;
      return normalizeValue(match[0]);
    }
  }
  return null;
}

/**
 * Collect the value found after a label pattern.
 *
 * @param {string} text - page text.
 * @param {string} pattern - source of the label regular expression.
 * @param {string} source - which tier this pattern belongs to.
 * @param {object} [options]
 * @param {boolean} [options.onlyImmediate] - accept only the run directly after the label.
 * @param {Array<object>} [options.layout] - where each run sat on the page.
 * @returns {Array<{ value: string, label: string, source: string }>}
 */
function hitsForPattern(text, pattern, source, options = {}) {
  const { onlyImmediate = false, layout = null } = options;
  const hits = [];
  const seenLabels = new Set();
  let regex;
  try {
    regex = new RegExp(pattern, 'gi');
  } catch {
    return hits;
  }
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match[0].length === 0) {
      regex.lastIndex += 1;
      continue;
    }
    const after = match.index + match[0].length;
    let value = null;
    if (onlyImmediate) {
      // The bare "Invoice" tier trusts only the very next run of characters, so
      // that a street address printed under an "INVOICE" title is never read as
      // the invoice number.
      const next = new RegExp(`^${TOKEN_SOURCE}`).exec(
        text.slice(after, after + VALUE_SEARCH_WINDOW)
      );
      if (next && looksLikeValue(next[0])) {
        const label = layout ? rangeOf(layout, match.index, after) : null;
        if (belongsToLabel(layout, label, after, after + next[0].length)) {
          value = normalizeValue(next[0]);
        }
      }
    } else {
      value = findValueAfterLabel(text, after, { layout, labelStart: match.index });
    }
    if (!value) continue;
    // One hit per label is enough - a label repeated in a header and a footer
    // says the same thing twice - but a *different* label with a different value
    // is worth keeping, because that is what a conflict looks like.
    const key = match[0].trim().replace(/\s+/g, ' ').toLowerCase();
    if (seenLabels.has(key)) continue;
    seenLabels.add(key);
    hits.push({ value, label: match[0].trim().replace(/\s+/g, ' '), source });
    if (hits.length >= MAX_HITS_PER_PATTERN) break;
  }
  return hits;
}

/**
 * How much slack a remembered spot gets, as a fraction of the page.
 *
 * About one line of an ordinary invoice, so a number that sits a little
 * differently on the next invoice is still found, while the column alongside it
 * is not swept in.
 */
const ZONE_SLACK = 0.012;

/**
 * How far each run of letters or digits may differ in length from the example
 * and still be the same kind of number. One either way, because numbering
 * grows: invoice 9998 is followed by 10002.
 */
const SHAPE_SLACK = 1;

/**
 * The shape of a value: its runs of letters and of digits, how long each run
 * is, and whatever separates them. "KLMN2231_4" is "A4 D4 _ D1".
 *
 * Kept instead of the value itself, so a profile remembers what a client's
 * invoice numbers look like without holding one of them.
 *
 * @param {string} value
 * @returns {string}
 */
export function valueShape(value) {
  const runs =
    String(value ?? '')
      .toUpperCase()
      .match(/[A-Z]+|[0-9]+|[^A-Z0-9\s]/g) ?? [];
  return runs
    .map((run) => {
      if (/^[A-Z]/.test(run)) return `A${run.length}`;
      if (/^[0-9]/.test(run)) return `D${run.length}`;
      return run;
    })
    .join(' ');
}

/**
 * Could this value be another number of the kind that has this shape?
 *
 * The same runs in the same order with the same separators, each run within a
 * character of the example's length. A spot saved with no shape accepts
 * anything value-shaped, as spots saved before shapes existed always did.
 *
 * @param {string} value
 * @param {string} [shape]
 * @returns {boolean}
 */
export function fitsShape(value, shape) {
  if (!shape) return true;
  const want = String(shape).split(' ');
  const have = valueShape(value).split(' ');
  if (want.length !== have.length) return false;
  return want.every((part, position) => {
    const wanted = /^([AD])(\d+)$/.exec(part);
    const found = /^([AD])(\d+)$/.exec(have[position]);
    if (!wanted || !found) return part === have[position];
    return wanted[1] === found[1] && Math.abs(Number(wanted[2]) - Number(found[2])) <= SHAPE_SLACK;
  });
}

/**
 * Read whatever stands in one region of a page.
 *
 * This is what makes "show me where the number is" work. Labels are no help on
 * a client whose wording is unreadable - text drawn over other text, a heading
 * that never appears as its own words - but the number is still printed in the
 * same place on every invoice they send, and that place can be pointed at once
 * and read from then on.
 *
 * Every run whose box meets the spot is taken, read in the order the page reads,
 * and the first run of characters among them shaped like a value is the answer.
 * A label caught along with the number does no harm: a label is not value-shaped.
 *
 * Given a shape, only a value of that shape counts. That is what keeps a
 * continuation page right: page 2 of an invoice often has nothing in the spot,
 * but sometimes has a subtotal or a line of the table there instead, and a
 * number of the wrong shape is ignored rather than read as a new invoice.
 *
 * @param {string} text - the full page text.
 * @param {Array<object>} layout - where each run sat, from extractText.js.
 * @param {object} zone - fractions of the page: { x0, y0, x1, y1 }, y from the bottom.
 * @param {{ width: number, height: number }} pageSize - the page's own size.
 * @param {string} [shape] - what the number looked like where it was pointed at.
 * @returns {string|null}
 */
export function detectInZone(text, layout, zone, pageSize, shape = '') {
  if (!layout?.length || !zone || !pageSize?.width || !pageSize?.height) return null;

  const left = (zone.x0 - ZONE_SLACK) * pageSize.width;
  const right = (zone.x1 + ZONE_SLACK) * pageSize.width;
  const bottom = (zone.y0 - ZONE_SLACK) * pageSize.height;
  const top = (zone.y1 + ZONE_SLACK) * pageSize.height;

  const page = String(text ?? '');
  const parts = [];
  for (const span of layout) {
    if (span.endX < left || span.x > right) continue;
    if (span.y + (span.fontSize ?? 0) < bottom || span.y > top) continue;
    parts.push(page.slice(span.start, span.end));
  }
  if (parts.length === 0) return null;

  const window = maskDates(parts.join(' '));
  TOKEN_PATTERN.lastIndex = 0;
  let match;
  while ((match = TOKEN_PATTERN.exec(window)) !== null) {
    if (!looksLikeValue(match[0])) continue;
    const value = normalizeValue(match[0]);
    if (fitsShape(value, shape)) {
      TOKEN_PATTERN.lastIndex = 0;
      return value;
    }
  }
  return null;
}

/**
 * Compile a user's own pattern, reporting a plain-language problem if it is broken.
 *
 * @param {string} pattern
 * @returns {{ regex: RegExp|null, error: string|null }}
 */
export function compileCustomPattern(pattern) {
  const source = String(pattern ?? '').trim();
  if (!source) return { regex: null, error: null };
  let regex;
  try {
    regex = new RegExp(source, 'gi');
  } catch (error) {
    return { regex: null, error: `This pattern could not be read: ${error.message}` };
  }
  if (!/\((?!\?)/.test(source)) {
    return {
      regex: null,
      error:
        'This pattern has no capture group. Put brackets around the part that is the invoice number, for example: Ref\\s*([0-9]+)',
    };
  }
  return { regex, error: null };
}

/** Every value a user's own pattern finds. */
function customHits(text, pattern) {
  const { regex } = compileCustomPattern(pattern);
  if (!regex) return [];
  const hits = [];
  let match;
  regex.lastIndex = 0;
  while ((match = regex.exec(text)) !== null) {
    if (match[0].length === 0) {
      regex.lastIndex += 1;
      continue;
    }
    const captured = match[1];
    if (!captured) continue;
    const whole = match[0];
    const at = whole.lastIndexOf(captured);
    const label = whole.slice(0, at).trim().replace(/\s+/g, ' ');
    hits.push({ value: normalizeValue(captured), label: label || pattern, source: 'custom' });
  }
  return hits;
}

/**
 * Words a label is made of that text recognition is known to get a letter
 * wrong in. Only words of five letters or more: in a shorter word one letter is
 * too much of the word to guess at.
 */
const LABEL_WORDS = ['invoice', 'credit', 'debit', 'document', 'number'];

/** Is `word` the same length as `target` and different in one letter at most? */
function oneLetterOff(word, target) {
  if (word.length !== target.length) return false;
  let differences = 0;
  for (let position = 0; position < word.length; position += 1) {
    if (word[position] !== target[position]) differences += 1;
    if (differences > 1) return false;
  }
  return true;
}

/**
 * Put right a label word that text recognition misread by one letter.
 *
 * A scan read as "Inveice Nr." or "lnvoice No" still says "Invoice", and a
 * person reading it would not hesitate. Each word of letters one letter away
 * from a label word is swapped for that word, letter for letter, so the text
 * keeps its length and everything found in it keeps its place. Numbers are
 * never touched: only words made entirely of letters are looked at.
 *
 * @param {string} text - text read from a scan.
 * @returns {string}
 */
export function mendMisreadLabels(text) {
  return String(text ?? '').replace(/[A-Za-z]{5,}/g, (word) => {
    const lower = word.toLowerCase();
    if (LABEL_WORDS.includes(lower)) return word;
    const meant = LABEL_WORDS.find((target) => oneLetterOff(lower, target));
    if (!meant) return word;
    return word === word.toUpperCase()
      ? meant.toUpperCase()
      : meant[0].toUpperCase() + meant.slice(1);
  });
}

/** Drop repeats of the same value found after the same label. */
function dedupe(hits) {
  const seen = new Set();
  return hits.filter((hit) => {
    const key = `${hit.value} ${hit.label.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * @typedef {object} DetectionSettings
 * @property {string[]} [profileLabels] labels from the profiles that matched this page.
 * @property {boolean} [useCommonLabels] also try everyday labels. Default true.
 * @property {boolean} [useBareInvoice] also try bare "Invoice 1234". Default true.
 * @property {string} [customPattern] a pattern that replaces all of the above.
 * @property {Array<object>} [layout] where each run sat on the page, from
 *   extractText.js. Without it detection falls back to reading order alone.
 * @property {Array<{ zone: object, name: string }>} [zones] spots pointed at for
 *   the clients that recognised this page. A spot that finds something is the
 *   answer, and the label tiers are not tried.
 * @property {{ width: number, height: number }} [pageSize] the page's own size.
 * @property {boolean} [scanned] the text was read from a scan, so a label word
 *   misread by one letter is read as the word it was meant to be.
 */

/**
 * Every invoice number this page offers, in the order the tiers are tried.
 *
 * @param {string} text
 * @param {DetectionSettings} [settings]
 * @returns {Array<{ value: string, label: string, source: string }>}
 */
export function detectCandidates(text, settings = {}) {
  const {
    profileLabels = [],
    useCommonLabels = true,
    useBareInvoice = true,
    customPattern,
    layout = null,
    zones = [],
    pageSize = null,
    scanned = false,
  } = settings;

  const page = scanned ? mendMisreadLabels(text) : String(text ?? '');
  if (!page.trim()) return [];

  if (customPattern && String(customPattern).trim()) {
    return dedupe(customHits(page, customPattern));
  }

  // Somebody pointed at where the number is on this client's invoices. That is
  // a better answer than any guess from the wording, so it is the only one.
  const fromZones = [];
  for (const entry of zones) {
    const value = detectInZone(page, layout, entry?.zone, pageSize, entry?.shape);
    if (value) {
      fromZones.push({ value, label: entry.name || 'this client', source: 'zone' });
    }
  }
  if (fromZones.length > 0) return dedupe(fromZones);

  const hits = [];
  for (const label of profileLabels) {
    const pattern = labelPattern(label);
    if (pattern) hits.push(...hitsForPattern(page, pattern, 'profile', { layout }));
  }
  if (useCommonLabels) {
    hits.push(...hitsForPattern(page, commonLabelPattern(), 'common', { layout }));
  }
  if (hits.length === 0 && useBareInvoice) {
    hits.push(
      ...hitsForPattern(page, bareInvoicePattern(), 'bare', { onlyImmediate: true, layout })
    );
  }
  return dedupe(hits);
}

/**
 * The invoice number for a page, or null if none was found.
 *
 * @param {string} text
 * @param {DetectionSettings} [settings]
 * @returns {{ value: string, label: string, source: string }|null}
 */
export function detectInvoiceNumber(text, settings = {}) {
  const [best] = detectCandidates(text, settings);
  return best ?? null;
}

/**
 * How sure text recognition was of a value, from 0 to 100.
 *
 * The least sure of the words the value was read from, where it first appears
 * on the page. Null when the page says nothing about how sure it was, which is
 * every page that was not read from a scan.
 *
 * @param {string} text - the page text.
 * @param {Array<object>|null} layout - where each run sat, with its confidence.
 * @param {string} value - a value found on the page.
 * @returns {number|null}
 */
export function valueConfidence(text, layout, value) {
  if (!value || !layout?.length) return null;
  const at = String(text ?? '')
    .toUpperCase()
    .indexOf(String(value).toUpperCase());
  if (at < 0) return null;
  const end = at + String(value).length;
  let least = null;
  for (const span of layout) {
    if (span.end <= at || span.start >= end || typeof span.confidence !== 'number') continue;
    least = least === null ? span.confidence : Math.min(least, span.confidence);
  }
  return least;
}

/**
 * Does this page offer two different numbers after two different labels?
 * That is worth showing to a person rather than guessing.
 *
 * @param {Array<{ value: string, label: string }>} candidates
 * @returns {boolean}
 */
export function hasConflict(candidates) {
  if (!candidates || candidates.length < 2) return false;
  const [first] = candidates;
  return candidates.some(
    (hit) => hit.value !== first.value && hit.label.toLowerCase() !== first.label.toLowerCase()
  );
}

/**
 * Find an extra field such as a PO number or a store number, using the same
 * "value after a label" rule as the invoice number itself.
 *
 * @param {string} text
 * @param {string|string[]} labels
 * @param {object} [options]
 * @param {Array<object>} [options.layout] - where each run sat on the page.
 * @returns {{ value: string, label: string }|null}
 */
export function detectFieldValue(text, labels, options = {}) {
  const { layout = null } = options;
  const page = String(text ?? '');
  const list = (Array.isArray(labels) ? labels : [labels]).filter(
    (label) => typeof label === 'string' && label.trim()
  );
  for (const label of list) {
    const pattern = labelPattern(label);
    if (!pattern) continue;
    const [hit] = hitsForPattern(page, pattern, 'profile', { layout });
    if (hit) return { value: hit.value, label: hit.label };
  }
  return null;
}

/** "PO" or "P.O.", with or without the dots and the space between them. */
const PO_WORD = 'p\\.?[^\\S\\r\\n]?o\\.?';

/** Whose purchase order it is, when a document says so. */
const PO_OWNERS = '(?:customer|cust\\.?|client|your)';

/**
 * The labels a purchase order number comes after.
 *
 * "PO" on its own is the start of "PO Box", which is on a great many of the
 * addresses an invoice prints. So plain "PO" only counts as a label with a
 * number word or a # after it - "PO #", "P.O. No.", "PO Number". "Purchase
 * order" and "Customer PO" say what they are without one.
 *
 * @returns {string}
 */
export function purchaseOrderLabelPattern() {
  const numberWord = `(?:#|(?:number|num|nbr|no)\\b)`;
  const owned = `${PO_OWNERS}${LABEL_GAP}${PO_WORD}(?:${LABEL_GAP}${numberWord})?`;
  const spelled = `purchase${LABEL_GAP}order(?:${LABEL_GAP}${numberWord})?`;
  const numbered = `${PO_WORD}${LABEL_GAP}${numberWord}`;
  return `${NOT_AFTER_LETTER}(?:${owned}|${spelled}|${numbered})${LABEL_TAIL}`;
}

/** Plain "PO" with the number straight after it, on the same line. */
function barePurchaseOrderPattern() {
  return `${NOT_AFTER_LETTER}${PO_WORD}${SAME_LINE_SPACE}[:#-]?${SAME_LINE_SPACE}`;
}

/**
 * The purchase order number on a page, or null if there is none.
 *
 * Collections work runs on POs as much as on invoice numbers: a customer's
 * accounts payable team files by their own order number, so that is the number
 * a remittance, a dispute or a chase refers to. Found the same way as an
 * invoice number - after a label, standing in its column when the label is a
 * heading - and then, failing that, plain "PO" with the number straight after
 * it. That last rule only takes the very next run, so "PO Box 2623" is never a
 * purchase order: "Box" is not shaped like a value.
 *
 * @param {string} text
 * @param {object} [options]
 * @param {Array<object>} [options.layout] - where each run sat on the page.
 * @returns {{ value: string, label: string }|null}
 */
export function detectPurchaseOrder(text, options = {}) {
  const page = String(text ?? '');
  if (!page.trim()) return null;
  const { layout = null } = options;

  const [labelled] = hitsForPattern(page, purchaseOrderLabelPattern(), 'po', { layout });
  if (labelled) return { value: labelled.value, label: labelled.label };

  const [bare] = hitsForPattern(page, barePurchaseOrderPattern(), 'po', {
    onlyImmediate: true,
    layout,
  });
  return bare ? { value: bare.value, label: bare.label } : null;
}
