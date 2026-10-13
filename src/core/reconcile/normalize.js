/**
 * The cleaned-up form of an invoice number used for matching.
 *
 * Invoice numbers are written differently in different places: "INV-00123" on
 * the PDF, "123" in the spreadsheet, "#123 " pasted from an email. To compare
 * them, each is cleaned up the same way:
 *
 * - spaces trimmed, letters made capitals;
 * - a known prefix taken off the front ("INV-", "INVOICE ", "NO.", "#");
 * - separators removed: spaces, hyphens, underscores, slashes, dots, "#";
 * - leading zeros dropped.
 *
 * The cleaned-up form is only ever used for comparing. What is shown is always
 * the number as it was written.
 */

/** Prefixes taken off the front, unless changed in Settings. */
export const DEFAULT_PREFIXES = ['INVOICE', 'INV', 'NO', 'NR', 'NUM', 'REF'];

/** Characters that only separate parts of a number. */
const SEPARATORS = /[\s\-_/.#:,]+/g;

/**
 * Turn the prefixes written in Settings - "INV-, Invoice, #" - into a clean list.
 *
 * @param {string|string[]} written
 * @returns {string[]} capitals, without separators, longest first.
 */
export function cleanPrefixes(written) {
  const list = Array.isArray(written) ? written : String(written ?? '').split(/[,;\n]+/);
  return [
    ...new Set(
      list.map((entry) => String(entry).toUpperCase().replace(SEPARATORS, '')).filter(Boolean)
    ),
  ].sort((a, b) => b.length - a.length);
}

/**
 * The form an invoice number is compared in.
 *
 * A prefix is only taken off when something with a digit follows it, so a
 * number that is all letters, or one that just happens to start with "NO", is
 * not eaten away: "INV-00123" becomes "123", but "NOVA-7" stays "NOVA7" unless
 * "NO" is directly followed by a separator or a digit.
 *
 * @param {unknown} value - as written.
 * @param {{ prefixes?: string[] }} [options] - cleaned with cleanPrefixes.
 * @returns {string} '' when there is nothing to compare.
 */
export function matchKey(value, { prefixes = DEFAULT_PREFIXES } = {}) {
  let text = String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/^[#\s]+/, '');
  for (const prefix of prefixes) {
    if (!text.startsWith(prefix)) continue;
    const rest = text.slice(prefix.length);
    // Followed by a separator, then something with a digit; or straight by a digit.
    if (/^[\s\-_/.#:,]+(?=.*\d)/.test(rest) || /^\d/.test(rest)) {
      text = rest;
      break;
    }
  }
  const joined = text.replace(SEPARATORS, '');
  const unpadded = joined.replace(/^0+(?=.)/, '');
  return unpadded;
}

/**
 * Do two numbers, as written, differ beyond spaces and capitals? Matches like
 * that are shown as "matched after cleanup", so nobody is surprised.
 */
export function writtenDifferently(a, b) {
  const plain = (value) =>
    String(value ?? '')
      .trim()
      .toUpperCase()
      .replace(/\s+/g, ' ');
  return plain(a) !== plain(b);
}
