/**
 * Learning where a value is printed, from one invoice somebody filled in.
 *
 * When the PO or the amount could not be found on an invoice and a person types
 * it in, the value is looked for on that invoice's own pages, and the label
 * printed with it - before it on the same line, or above it - is remembered.
 * Every other invoice is then read with that label as well, so one entry fills
 * the rest of a batch from the same supplier, and the next batch too.
 *
 * A label is only learned if reading the invoice with it gives back exactly
 * what was typed: a guess that cannot reproduce its own example is no use.
 */

import { labelPattern, parseMoney, phrasesOf, poKey, readFields } from './fields.js';

/** What a label can be: a few words, not a number or a sentence. */
function usableLabel(text) {
  // A currency sign or code before the amount belongs to the amount, not the label.
  const label = String(text ?? '')
    .trim()
    .replace(/(\s+(usd|eur|gbp|chf))?[\s:#.$€£-]*$/i, '');
  if (label.length < 2 || label.length > 40) return null;
  if ((label.match(/[A-Za-zÀ-ÿ]/g) ?? []).length < 2) return null;
  // "Date: Oct 1, 2026" is a value of its own, not the label of the one below it.
  if (/\d{2,}/.test(label)) return null;
  if (label.split(/\s+/).length > 5) return null;
  return label;
}

const MONEY_LIKE =
  /(?:[$€£]\s?|\b(?:USD|EUR|GBP|CHF)\s?)?\(?-?\d[\d.,'\u00a0 ]*\d\)?(?:\s?(?:USD|EUR|GBP|CHF|€))?/gi;

/** Whether a piece of text holds the value typed, however it was written. */
function holds(field, text, typed) {
  if (field === 'po') {
    const key = poKey(typed);
    return key.length >= 2 && poKey(text).includes(key);
  }
  const want = parseMoney(typed) ?? parseMoney(`${typed} USD`);
  if (!want) return false;
  // Every piece of the text that looks like money: "$812.40", "USD 812.40", "1.297,48 €".
  const pieces = String(text).match(MONEY_LIKE) ?? [];
  return pieces.some((piece) => {
    const money = parseMoney(piece.trim()) ?? parseMoney(`${piece.trim()} USD`);
    return money && Math.abs(money.amount - want.amount) < 0.005;
  });
}

/** Where the value starts in a phrase, for what comes before it there. */
function startOf(field, text, typed) {
  if (field === 'total') {
    // The money in the phrase that is the amount typed, however it is written there.
    const want = parseMoney(typed) ?? parseMoney(`${typed} USD`);
    for (const match of String(text).matchAll(MONEY_LIKE)) {
      const money = parseMoney(match[0].trim()) ?? parseMoney(`${match[0].trim()} USD`);
      if (money && want && Math.abs(money.amount - want.amount) < 0.005) {
        return match.index + (match[0].length - match[0].trimStart().length);
      }
    }
    return 0;
  }
  const plain = String(typed).trim();
  let at = text.toLowerCase().indexOf(plain.toLowerCase());
  if (at < 0) {
    // Typed without its punctuation: find its longest run of digits.
    const digits = (plain.match(/\d+/g) ?? []).sort((a, b) => b.length - a.length)[0];
    at = digits ? text.indexOf(digits) : -1;
  }
  if (at < 0) return 0;
  // A "PO-" printed in front belongs to the value, not to the label.
  const lead = text.slice(0, at).match(/(p\.?\s?o\.?)?[\s#-]*$/i);
  return at - (lead?.[0].length ?? 0);
}

/** Candidate labels for a value found in a phrase: before it, to its left, above it. */
function labelsAround(phrases, phrase, field, typed) {
  const found = [];
  const before = usableLabel(phrase.text.slice(0, startOf(field, phrase.text, typed)));
  if (before) found.push(before);
  const left = phrases
    .filter((other) => other.band === phrase.band && other.endX <= phrase.x + 1)
    .sort((a, b) => b.endX - a.endX)[0];
  if (left && usableLabel(left.text)) found.push(usableLabel(left.text));
  const above = phrases
    .filter(
      (other) =>
        other.band < phrase.band &&
        other.band >= phrase.band - 3 &&
        other.x < phrase.endX + 20 &&
        other.endX > phrase.x - 20
    )
    .sort((a, b) => b.band - a.band)[0];
  if (above && usableLabel(above.text)) found.push(usableLabel(above.text));
  return found;
}

/**
 * The label to remember for a value typed in for one invoice, or null if no
 * label beside it reads it back.
 *
 * @param {Array<{ text: string, layout?: Array<object> }>} pages - that invoice's pages.
 * @param {'po'|'total'} field
 * @param {string} typed - what the person typed.
 * @param {string[]} [notLabels] - text that is never a label, such as the
 *   customer's name printed above the value.
 * @returns {string|null}
 */
export function learnLabel(pages = [], field, typed, notLabels = []) {
  const names = new Set(notLabels.filter(Boolean).map(customerKey));
  if (!String(typed ?? '').trim()) return null;
  for (const page of pages) {
    const phrases = phrasesOf(page);
    for (const phrase of phrases) {
      if (!holds(field, phrase.text, typed)) continue;
      for (const label of labelsAround(phrases, phrase, field, typed)) {
        if (names.has(customerKey(label))) continue;
        // Kept only if it finds what was typed, on this very invoice.
        const read = readFields(pages, { [field]: [label] })[field];
        const value = field === 'po' ? read?.value : read?.raw;
        if (value && holds(field, value, typed)) return label;
      }
    }
  }
  return null;
}

/**
 * Remember a label, without repeating one already known.
 *
 * @param {{ po?: string[], total?: string[] }} learned
 * @param {'po'|'total'} field
 * @param {string} label
 */
export function withLabel(learned, field, label) {
  const known = learned[field] ?? [];
  if (known.some((entry) => labelPattern(entry).test(label))) return learned;
  return { ...learned, [field]: [...known, label] };
}

/* -------------------------------------------- PO shapes, customer by customer */

/** A customer's name as a key: case, spaces and punctuation do not matter. */
export function customerKey(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * The shape of a PO as a pattern: its letters as they are, each run of digits
 * as that many digits, its marks as they are. "BR-1001" is BR-, then 4 digits;
 * "PO 55103388" is PO, maybe a space, then 8 digits.
 *
 * @param {string} value
 * @returns {string|null} a RegExp source, or null for a value with no digits.
 */
export function poPattern(value) {
  const runs = String(value ?? '')
    .trim()
    .toUpperCase()
    .match(/[A-Z]+|\d+|\s+|[^A-Z\d\s]/g);
  if (!runs || !runs.some((run) => /\d/.test(run))) return null;
  return runs
    .map((run) => {
      if (/^\d/.test(run)) return `\\d{${run.length}}`;
      if (/^\s/.test(run)) return '\\s?';
      if (/^[A-Z]/.test(run)) return run;
      return run.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
    })
    .join('');
}

/** A pattern as a person reads it: "BR-####", "PO ########". */
export function describePattern(source) {
  return source
    .replace(/\\d\{(\d+)\}/g, (_, count) => '#'.repeat(Number(count)))
    .replace(/\\s\?/g, ' ')
    .replace(/\\(.)/g, '$1');
}

/**
 * The one value on an invoice's pages that has one of these shapes, or null
 * when there is none - or more than one, which would be a guess.
 *
 * @param {Array<{ text: string }>} pages
 * @param {string[]} patterns
 * @param {string[]} [not] - values that are something else, such as the invoice number.
 * @returns {{ value: string, raw: string }|null}
 */
export function findByPattern(pages, patterns = [], not = []) {
  const excluded = new Set(not.filter(Boolean).map(poKey));
  const found = new Map();
  for (const source of patterns) {
    const pattern = new RegExp(`(?<![A-Za-z0-9])${source}(?![A-Za-z0-9])`, 'gi');
    for (const page of pages) {
      for (const match of String(page.text ?? '').matchAll(pattern)) {
        const key = poKey(match[0]);
        if (!excluded.has(key) && !found.has(key)) found.set(key, match[0]);
      }
    }
  }
  if (found.size !== 1) return null;
  const [raw] = found.values();
  return { value: raw, raw };
}

/**
 * Remember the shape of a customer's POs, from one typed in.
 *
 * @param {{ poPatterns?: Record<string, { name: string, patterns: string[] }> }} learned
 * @param {string} customer - as printed on the invoice.
 * @param {string} po - as typed.
 */
export function withPoPattern(learned, customer, po) {
  const key = customerKey(customer);
  const source = poPattern(po);
  if (!key || !source) return learned;
  const known = learned.poPatterns?.[key] ?? { name: customer, patterns: [] };
  if (known.patterns.includes(source)) return learned;
  return {
    ...learned,
    poPatterns: {
      ...learned.poPatterns,
      [key]: { name: known.name, patterns: [...known.patterns, source] },
    },
  };
}

/**
 * A PO no label gave, found by the shape of this customer's POs.
 *
 * @param {object} fields - readFields() of the invoice.
 * @param {Array<{ text: string }>} pages
 * @param {object} learned
 * @param {string|null} invoice - its number, which is never its PO.
 * @returns {object} the fields, with `po` filled when exactly one value has the shape.
 */
export function withPatternPo(fields, pages, learned, invoice) {
  if (fields?.po || !fields?.customer || !pages) return fields;
  const known = learned.poPatterns?.[customerKey(fields.customer)];
  if (!known) return fields;
  const found = findByPattern(pages, known.patterns, [invoice]);
  return found ? { ...fields, po: { ...found, pattern: known.name } } : fields;
}
