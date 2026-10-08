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
export const FLAG_ORDER = [
  'no-number',
  'conflict',
  'near-list',
  'not-in-list',
  'odd-shape',
  'out-of-sequence',
  'unread-number',
  'page-order',
  'page-count',
  'no-client',
  'blank-page',
  'duplicate-name',
  'fallback',
  'ocr',
];

/** "page 5" or "pages 5 and 7". */
function pageList(numbers = []) {
  if (numbers.length === 1) return `page ${numbers[0]}`;
  return `pages ${numbers.slice(0, -1).join(', ')} and ${numbers[numbers.length - 1]}`;
}

/** "Page 5" from "page 5". */
function capitalise(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Where a reading came from, in words: "the box you drew", "after "Invoice No:"". */
function readingFrom(hit) {
  if (hit.source === 'zone') return 'in the box you drew';
  if (hit.source === 'bare') return 'after the word "Invoice"';
  if (hit.source === 'box-crop') return hit.label;
  return `after "${hit.label}"`;
}

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
  const note = group.notes?.[flag] ?? {};

  switch (flag) {
    case 'no-number':
      return `No invoice number was found on ${where}.`;
    case 'conflict': {
      const readings = note.readings ?? [];
      if (readings.length >= 2) {
        const said = readings.map((hit) => `${hit.value} (${readingFrom(hit)})`).join(' and ');
        return `Page ${note.page} gives two different numbers: ${said}. ${group.invoice} was used.`;
      }
      return `Two different invoice numbers appear on ${where}. ${group.invoice} was used.`;
    }
    case 'near-list': {
      const close = note.suggestion ? `, but ${note.suggestion} is` : '';
      const why =
        note.why === 'look-alike'
          ? ' - they differ only by letters and digits that look alike'
          : note.suggestion
            ? ' - one character differs'
            : '';
      return `${group.invoice} on ${where} is not in your invoice list${close}${why}.`;
    }
    case 'not-in-list':
      return `${group.invoice} on ${where} is not in your invoice list.`;
    case 'odd-shape': {
      const usual = note.looksLike ? `, which are ${note.looksLike}` : '';
      const fix = note.suggestion ? ` ${note.suggestion} would fit.` : '';
      return `${group.invoice} on ${where} does not look like this client's other numbers${usual}.${fix}`;
    }
    case 'out-of-sequence': {
      const range = note.from && note.to ? ` (${note.from} to ${note.to})` : '';
      return `${group.invoice} on ${where} is far from this client's other numbers in this batch${range}.`;
    }
    case 'page-order':
      return note.kind === 'restart'
        ? `Page ${note.page} says "Page 1 of", but it is in the middle of this invoice (${where}). Two invoices may have been joined.`
        : `The "Page X of Y" marks on ${where} are out of order.`;
    case 'page-count':
      if (!note.says)
        return `The "Page X of Y" marks on ${where} do not match how many pages are here.`;
      return `The pages say this invoice has ${note.says} ${note.says === 1 ? 'page' : 'pages'}, but ${note.has} ${
        note.has === 1 ? 'is' : 'are'
      } here (${where}). A page may be missing, or belong to another invoice.`;
    case 'unread-number': {
      const pages = note.pages?.length ? note.pages : group.pages.map((page) => page.index);
      const one = pages.length === 1;
      return `${capitalise(pageList(pages))} ${one ? 'seems' : 'seem'} to have an invoice number of ${
        one ? 'its' : 'their'
      } own, but it could not be read, so ${one ? 'it was' : 'they were'} kept with ${
        group.invoice ?? 'the invoice before'
      }. Check ${one ? 'it is' : 'they are'} not a separate invoice.`;
    }
    case 'blank-page': {
      const pages = note.pages?.length ? note.pages : group.pages.map((page) => page.index);
      return `${capitalise(pageList(pages))} ${pages.length === 1 ? 'is' : 'are'} blank.`;
    }
    case 'no-client': {
      const pages = note.pages?.length ? note.pages : group.pages.map((page) => page.index);
      const one = pages.length === 1;
      return `${capitalise(pageList(pages))} ${one ? 'does' : 'do'} not match any client you have drawn a box for. ${
        one ? 'It' : 'They'
      } may belong to another client.`;
    }
    case 'duplicate-name':
      // Said the same way for both invoices in a clash: only one of them has a
      // name that actually changed, so neither sentence claims that it did.
      return `Another invoice has the same number. This one is saved as ${group.fileName}.`;
    case 'fallback':
      return `${group.invoice} came from the word "Invoice" on its own, with no label after it. Worth a glance at ${where}.`;
    case 'ocr':
      if (!group.invoice) {
        return `The text on ${where} was read from a scan, so the number may not be right.`;
      }
      {
        const page = note.page ?? group.pages[0].index;
        return typeof note.confidence === 'number' && note.confidence < 75
          ? `${group.invoice} was read from a scan on page ${page}, and the app was only ${note.confidence}% sure of it.`
          : `${group.invoice} was read from a scan on page ${page}, and nothing else on the page backs it up. Check it against the page.`;
      }
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
