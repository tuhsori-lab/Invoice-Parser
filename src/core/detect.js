/**
 * Finding the invoice number on a page.
 *
 * Every client lays its invoices out differently, so there is no single rule
 * that works everywhere. Instead we try four tiers in a fixed order and stop at
 * the first hit. Which tier answered is reported back as `source`, and the exact
 * words the number was found after are reported as `label`, so the person using
 * the app can always see why a number was picked.
 *
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
  'invoice',
  'inv',
  'billing',
  'bill',
  'document',
  'doc',
];

/** Second half of a common label: "#", or a word that means "number". */
const COMMON_SECOND_WORDS = ['number', 'num', 'nbr', 'no', 'id', 'ref'];

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

/** Runs of characters that could be a value. */
const TOKEN_PATTERN = /[A-Za-z0-9][A-Za-z0-9-]*/g;

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
  const second = `(?:#|(?:${COMMON_SECOND_WORDS.join('|')})\\b)`;
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

/** Tidy a raw value: upper case, no trailing hyphens. */
export function normalizeValue(token) {
  return String(token).toUpperCase().replace(/-+$/, '');
}

/** Could this run of characters be an invoice number? */
function isUsableValue(token) {
  if (!/\d/.test(token)) return false;
  if (isDateShaped(token)) return false;
  return normalizeValue(token).length >= MIN_VALUE_LENGTH;
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
 * placed as well as the whole of it - which is what makes the "10012" inside
 * "NEW YORK, NY 10012" locatable on its own.
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
    if (isUsableValue(match[0]) && belongsToLabel(layout, label, at, at + match[0].length)) {
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
      const next = /^[A-Za-z0-9][A-Za-z0-9-]*/.exec(text.slice(after, after + VALUE_SEARCH_WINDOW));
      if (next && isUsableValue(next[0])) {
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
 */

/**
 * Every invoice number this page offers, in the order the tiers are tried.
 *
 * @param {string} text
 * @param {DetectionSettings} [settings]
 * @returns {Array<{ value: string, label: string, source: string }>}
 */
export function detectCandidates(text, settings = {}) {
  const page = String(text ?? '');
  if (!page.trim()) return [];

  const {
    profileLabels = [],
    useCommonLabels = true,
    useBareInvoice = true,
    customPattern,
    layout = null,
  } = settings;

  if (customPattern && String(customPattern).trim()) {
    return dedupe(customHits(page, customPattern));
  }

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
