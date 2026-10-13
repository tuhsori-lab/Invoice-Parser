/**
 * What is missing, pulled out into rows for a spreadsheet.
 *
 * One row per thing to chase, each saying what it is in plain words:
 *
 * - an invoice in your list that is not in this batch;
 * - an invoice in this batch that is not in your list;
 * - pages where no invoice number was found;
 * - an invoice with no PO found on it;
 * - an invoice whose PO is not the one your list has for it.
 *
 * Built from what the app already worked out - nothing is read again.
 */

import { pageRangeForCsv } from './naming.js';
import { checkNumber, normalizeKnown } from './knownList.js';

/** The kinds of row, in the order they come in the file, and how each is described. */
export const REPORT_KINDS = [
  { key: 'missing-from-batch', label: 'In your list, not in this batch', needsList: true },
  { key: 'not-in-list', label: 'In this batch, not in your list', needsList: true },
  { key: 'no-number', label: 'No invoice number found', needsList: false },
  { key: 'po-not-found', label: 'No PO found', needsList: false },
  { key: 'po-different', label: 'PO is not the one in your list', needsList: true, needsPo: true },
];

/** Columns of the report, in order. */
export const REPORT_COLUMNS = [
  'What',
  'Invoice',
  'Pages',
  'PO on the invoice',
  'PO in your list',
  'Client',
  'Note',
];

/**
 * POs compared by their letters and digits only, and without a "PO" in front:
 * a list that says 5512 and an invoice that says PO-5512 mean the same order.
 */
function samePo(a, b) {
  const clean = (value) =>
    String(value ?? '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .replace(/^PO(?=\d)/, '');
  return clean(a) === clean(b);
}

/**
 * Every row of the report.
 *
 * @param {Array<object>} groups - checked invoices, as the table shows them.
 * @param {object} [context]
 * @param {ReturnType<import('./knownList.js').buildKnownList>|null} [context.knownList]
 * @param {Array<{ value: string, client: string }>} [context.missing] - list entries not
 *   found in this batch, as verifyGroups gives them.
 * @returns {Array<{ kind: string, cells: Array<string|number> }>}
 */
export function buildReport(groups = [], { knownList = null, missing = [] } = {}) {
  const rows = [];
  const label = Object.fromEntries(REPORT_KINDS.map((kind) => [kind.key, kind.label]));
  const add = (kind, { invoice = '', pages = '', po = '', listPo = '', client = '', note = '' }) =>
    rows.push({ kind, cells: [label[kind], invoice, pages, po, listPo, client, note] });

  if (knownList) {
    for (const entry of missing) {
      add('missing-from-batch', {
        invoice: entry.value,
        listPo: knownList.byValue.get(entry.value)?.po ?? '',
        client: entry.client,
      });
    }
  }

  for (const group of groups) {
    const pages = pageRangeForCsv(group.pages.map((page) => page.index));
    const po = group.po?.value ?? '';
    const entry = group.invoice ? knownList?.byValue.get(normalizeKnown(group.invoice)) : null;
    const client = entry?.client ?? '';

    if (!group.invoice) {
      add('no-number', { pages, po, note: 'Type the number in, or check these pages' });
    } else if (knownList && !entry) {
      const check = checkNumber(group.invoice, knownList);
      add('not-in-list', {
        invoice: group.invoice,
        pages,
        po,
        note: check.status === 'near' ? `Close to ${check.suggestion} in your list` : '',
      });
    }

    if (!po) {
      const partial = group.pages.some((page) => page.partial);
      add('po-not-found', {
        invoice: group.invoice ?? '',
        pages,
        listPo: entry?.po ?? '',
        client,
        note: partial
          ? 'Not read: only the top, the box and the foot of these scanned pages were read'
          : '',
      });
    } else if (knownList?.hasPo && entry?.po && !samePo(po, entry.po)) {
      add('po-different', { invoice: group.invoice, pages, po, listPo: entry.po, client });
    }
  }

  const order = REPORT_KINDS.map((kind) => kind.key);
  return rows.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
}

/**
 * How many rows of each kind there are, for choosing what goes in the file.
 *
 * @param {ReturnType<typeof buildReport>} rows
 * @returns {Record<string, number>}
 */
export function countReport(rows = []) {
  const counts = Object.fromEntries(REPORT_KINDS.map((kind) => [kind.key, 0]));
  for (const row of rows) counts[row.kind] += 1;
  return counts;
}
