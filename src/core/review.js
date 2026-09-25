/**
 * Saying, in plain words, what needs a person's eye.
 *
 * The people this app is for are not developers. A flag called `no-number` is
 * meaningless to them; "No invoice number was found on pages 5 to 6" is not.
 * Every reason names the pages, so it can be acted on without opening anything.
 */

import { pageRangeForCsv } from './naming.js';

/**
 * Which problem to lead with when an invoice has several.
 * Worst first: a missing number stops the work, an OCR warning merely slows it.
 */
export const FLAG_ORDER = ['no-number', 'conflict', 'duplicate-name', 'fallback', 'ocr'];

/** "page 5", or "pages 5 to 6, 9". */
export function describePages(group) {
  const numbers = group.pages.map((page) => page.index);
  const range = pageRangeForCsv(numbers);
  return numbers.length === 1 ? `page ${range}` : `pages ${range}`;
}

/**
 * One sentence about one problem with one invoice.
 *
 * @param {string} flag
 * @param {object} group
 * @returns {string}
 */
export function reviewReason(flag, group) {
  const where = describePages(group);

  switch (flag) {
    case 'no-number':
      return `No invoice number was found on ${where}.`;
    case 'conflict':
      return `Two different invoice numbers appear on ${where}. ${group.invoice} was used.`;
    case 'duplicate-name':
      // Said the same way for both invoices in a clash: only one of them has a
      // name that actually changed, so neither sentence claims that it did.
      return `Another invoice has the same number. This one is saved as ${group.fileName}.`;
    case 'fallback':
      return `${group.invoice} came from the word "Invoice" on its own, with no label after it. Worth a glance at ${where}.`;
    case 'ocr':
      return `The text on ${where} was read from a scan, so the number may not be right.`;
    default:
      return `Something on ${where} is worth checking.`;
  }
}

/**
 * Everything a person should look at before exporting, in page order, worst
 * problem first within each invoice.
 *
 * @param {Array<object>} groups
 * @returns {Array<{ id: string, group: object, flag: string, reasons: string[] }>}
 */
export function reviewQueue(groups = []) {
  return groups
    .filter((group) => group.flags?.length > 0)
    .map((group) => {
      const ordered = [
        ...FLAG_ORDER.filter((flag) => group.flags.includes(flag)),
        ...group.flags.filter((flag) => !FLAG_ORDER.includes(flag)),
      ];
      return {
        id: group.id,
        group,
        flag: ordered[0],
        reasons: ordered.map((flag) => reviewReason(flag, group)),
      };
    });
}

/**
 * The sentence shown before exporting while problems remain.
 *
 * @param {number} count - how many invoices still need a look.
 * @returns {string}
 */
export function exportWarning(count) {
  if (count === 1) return '1 invoice still needs a look. Export anyway?';
  return `${count} invoices still need a look. Export anyway?`;
}
