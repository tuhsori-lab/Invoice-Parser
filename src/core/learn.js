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
 * @returns {string|null}
 */
export function learnLabel(pages = [], field, typed) {
  if (!String(typed ?? '').trim()) return null;
  for (const page of pages) {
    const phrases = phrasesOf(page);
    for (const phrase of phrases) {
      if (!holds(field, phrase.text, typed)) continue;
      for (const label of labelsAround(phrases, phrase, field, typed)) {
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
