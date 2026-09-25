/**
 * Naming the files that come out.
 *
 * The name is built from a template the user can change. Tokens are written in
 * curly brackets and are replaced with what the invoice actually has:
 *
 *   {prefix}   text the user types in front of every name
 *   {invoice}  the invoice number
 *   {extra}    the extra field, e.g. a PO number
 *   {client}   the client profile that recognised the pages
 *   {pages}    the pages this invoice came from, e.g. 5-6
 *   {index}    the invoice's position in the batch, counting from 1
 *
 * When a token has nothing to put in it, the separator next to it disappears
 * too, so `{prefix}{invoice}_{extra}` gives "INV-104233" and not "INV-104233_".
 */

/** What the file name template starts as. */
export const DEFAULT_TEMPLATE = '{prefix}{invoice}_{extra}';

/** What an invoice with no number is called. */
export const NO_NUMBER_STEM = 'NO-NUMBER';

/** Longest file name we will produce, including the .pdf on the end. */
export const MAX_FILENAME_LENGTH = 150;

const EXTENSION = '.pdf';

/** Characters Windows will not accept in a file name. */
// eslint-disable-next-line no-control-regex -- stripping control characters is the job here
const ILLEGAL_CHARACTERS = new RegExp('[<>:"/\\\\|?*]|[\\u0000-\\u001f]', 'g');

/** Names Windows reserves for devices, whatever the extension. */
const RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** Characters that only make sense between two pieces of a name. */
const SEPARATORS = '-_ .';

/**
 * Turn page numbers into runs, e.g. [1,2,3,7] into [[1,3],[7,7]].
 *
 * @param {number[]} pageNumbers
 * @returns {Array<[number, number]>}
 */
export function pageRuns(pageNumbers = []) {
  const sorted = [...new Set(pageNumbers)].sort((a, b) => a - b);
  const runs = [];
  for (const page of sorted) {
    const last = runs[runs.length - 1];
    if (last && page === last[1] + 1) last[1] = page;
    else runs.push([page, page]);
  }
  return runs;
}

/**
 * Page numbers as they appear in a file name: "5-6", or "5-6+9" when the pages
 * are not all next to each other.
 *
 * @param {number[]} pageNumbers
 * @returns {string}
 */
export function pageRangeForName(pageNumbers = []) {
  return pageRuns(pageNumbers)
    .map(([from, to]) => (from === to ? `${from}` : `${from}-${to}`))
    .join('+');
}

/**
 * Page numbers as they appear in the CSV: "1 to 3, 7".
 *
 * Written the long way on purpose: Excel reads "1-3" as a date and shows
 * "3-Jan" instead of the pages.
 *
 * @param {number[]} pageNumbers
 * @returns {string}
 */
export function pageRangeForCsv(pageNumbers = []) {
  return pageRuns(pageNumbers)
    .map(([from, to]) => (from === to ? `${from}` : `${from} to ${to}`))
    .join(', ');
}

/** Replace anything Windows will not accept, and tidy what is left. */
export function sanitizeFileName(name) {
  const cleaned = String(name ?? '')
    .replace(ILLEGAL_CHARACTERS, '-')
    .replace(/\s+/g, ' ')
    .replace(/[-_ ]{2,}/g, (run) => run[0])
    .trim()
    .replace(/^[-_. ]+/, '')
    .replace(/[-_. ]+$/, '');
  if (!cleaned) return 'invoice';
  if (RESERVED_NAMES.test(cleaned)) return `_${cleaned}`;
  return cleaned;
}

/**
 * Fill a template in, dropping the separator beside any token that is empty.
 *
 * @param {string} template
 * @param {Record<string, string>} values
 * @returns {string}
 */
export function fillTemplate(template, values) {
  const parts = String(template).split(/(\{[a-z]+\})/i);
  let out = '';
  for (const part of parts) {
    const token = /^\{([a-z]+)\}$/i.exec(part);
    if (!token) {
      out += part;
      continue;
    }
    const value = String(values[token[1].toLowerCase()] ?? '');
    if (value) {
      out += value;
      continue;
    }
    // Nothing to put here, so the separator leading up to it goes too.
    let end = out.length;
    while (end > 0 && SEPARATORS.includes(out[end - 1])) end -= 1;
    out = out.slice(0, end);
  }
  return out;
}

/**
 * The file name for one invoice, before duplicates are dealt with.
 *
 * @param {object} group - a group from group.js.
 * @param {object} [options]
 * @param {string} [options.template]
 * @param {string} [options.prefix]
 * @param {number} [options.index] - 1-based position of this invoice in the batch.
 * @param {number} [options.total] - how many invoices there are, for padding {index}.
 * @returns {string} a file name ending in .pdf.
 */
export function buildFileName(group, options = {}) {
  const { prefix = '', index = 1, total = 1 } = options;
  // A client profile may name its own files; otherwise the batch-wide pattern.
  const template = group.template || options.template || DEFAULT_TEMPLATE;
  const pageNumbers = group.pages.map((page) => page.index);
  const pages = pageRangeForName(pageNumbers);
  const width = String(Math.max(total, 1)).length;

  const stem = group.invoice
    ? fillTemplate(template, {
        prefix,
        invoice: group.invoice,
        extra: group.extra?.value ?? '',
        client: group.client ?? '',
        pages,
        index: String(index).padStart(width, '0'),
      })
    : // An invoice with no number is still a file, so name it after its pages:
      // NO-NUMBER_p5-6 tells the user exactly where to look.
      `${prefix}${NO_NUMBER_STEM}_p${pages}`;

  const safe = sanitizeFileName(stem);
  return `${truncate(safe, MAX_FILENAME_LENGTH - EXTENSION.length)}${EXTENSION}`;
}

/** Cut a name down to length without leaving a separator dangling. */
function truncate(name, limit) {
  if (name.length <= limit) return name;
  return name.slice(0, limit).replace(/[-_. ]+$/, '');
}

/**
 * Give every invoice a file name, and make sure no two are the same.
 *
 * Two clients really do send invoice "1001", so the second one becomes
 * "1001 (2).pdf" rather than quietly overwriting the first.
 *
 * @param {Array<object>} groups
 * @param {object} [options] - see {@link buildFileName}.
 * @returns {Array<object>} the same groups, each with `fileName` set and the
 *   'duplicate-name' flag added where a name had to be made unique.
 */
export function assignFileNames(groups = [], options = {}) {
  const bases = groups.map((group, position) =>
    buildFileName(group, { ...options, index: position + 1, total: groups.length })
  );

  const counts = new Map();
  for (const base of bases) {
    const key = base.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const used = new Map();
  return groups.map((group, position) => {
    const base = bases[position];
    const key = base.toLowerCase();
    const seen = used.get(key) ?? 0;
    used.set(key, seen + 1);

    const clashes = (counts.get(key) ?? 0) > 1;
    const flags =
      clashes && !group.flags?.includes('duplicate-name')
        ? [...(group.flags ?? []), 'duplicate-name']
        : group.flags;

    if (seen === 0) return { ...group, fileName: base, flags };

    const suffix = ` (${seen + 1})`;
    const stem = base.slice(0, -EXTENSION.length);
    const room = MAX_FILENAME_LENGTH - EXTENSION.length - suffix.length;
    return { ...group, fileName: `${truncate(stem, room)}${suffix}${EXTENSION}`, flags };
  });
}
