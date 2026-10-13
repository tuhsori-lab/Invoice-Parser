/**
 * The list of invoice numbers a person already knows are real.
 *
 * Most accounting systems will export their open invoices as a CSV or an Excel
 * file. Loaded here, that list is the best check there is on a number read off
 * a page: a number in the list is real, a number one character away from one in
 * the list is very probably a misreading of it, and a number in the list that
 * no invoice in the batch carries is an invoice that went missing.
 *
 * Everything here is plain JavaScript working on text the browser has already
 * read from the file. The list is never stored and never sent anywhere.
 */

import { normalizeValue } from './detect.js';

/* ------------------------------------------------------------- reading */

/**
 * Split CSV text into rows of cells.
 *
 * Handles quoted cells (with "" for a quote inside one), line breaks inside
 * quotes, a byte order mark, and whichever of comma, semicolon or tab the file
 * uses - Excel in much of Europe writes semicolons.
 *
 * @param {string} text
 * @returns {string[][]}
 */
export function parseCsv(text) {
  const source = String(text ?? '').replace(/^\uFEFF/, '');
  const firstLine = source.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = [',', ';', '\t'].reduce((best, candidate) =>
    firstLine.split(candidate).length > firstLine.split(best).length ? candidate : best
  );

  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let at = 0; at < source.length; at += 1) {
    const char = source[at];
    if (quoted) {
      if (char === '"' && source[at + 1] === '"') {
        cell += '"';
        at += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[at + 1] === '\n') at += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((value) => value.trim() !== ''));
}

/** Undo the five entities XML uses for its own punctuation, and numeric ones. */
function unescapeXml(text) {
  return String(text)
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal) => String.fromCodePoint(Number(decimal)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** All the text inside an element, however many <t> runs it is split into. */
function textRuns(xml) {
  const runs = [...String(xml).matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => m[1]);
  return unescapeXml(runs.join(''));
}

/** "AB" to 27, the way spreadsheets count columns, from zero. */
function columnIndex(reference) {
  const letters = /^[A-Z]+/.exec(reference)?.[0] ?? 'A';
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

/**
 * A number Excel stored as a number, written the way a person would type it.
 * "4.0017822E7" is the invoice 40017822, not something to show in exponent form.
 */
function plainNumber(text) {
  const value = Number(text);
  if (!Number.isFinite(value)) return text;
  if (Number.isInteger(value) && Math.abs(value) < 1e15) return String(value);
  return text;
}

/**
 * Read the cells of one worksheet out of an Excel file's XML.
 *
 * An .xlsx file is a ZIP of XML documents; the browser side unzips it and hands
 * over the two that matter: the worksheet, and the shared strings most text
 * cells point into. Only the cell values are read - no formatting, no formulas.
 *
 * @param {{ sheet: string, sharedStrings?: string }} parts
 * @returns {string[][]}
 */
export function rowsFromSpreadsheetXml({ sheet, sharedStrings = '' }) {
  const shared = [...String(sharedStrings).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    textRuns(m[1])
  );
  const rows = [];
  for (const rowMatch of String(sheet).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = [];
    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attributes = cellMatch[1];
      const body = cellMatch[2] ?? '';
      const reference = /\br="([A-Z]+)\d+"/.exec(attributes)?.[1];
      const type = /\bt="([^"]+)"/.exec(attributes)?.[1] ?? 'n';
      const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value = '';
      if (type === 's') value = shared[Number(raw)] ?? '';
      else if (type === 'inlineStr') value = textRuns(body);
      else if (type === 'str' || type === 'b' || type === 'e') value = unescapeXml(raw ?? '');
      else value = raw === undefined ? '' : plainNumber(unescapeXml(raw));
      const position = reference ? columnIndex(reference) : cells.length;
      cells[position] = value;
    }
    for (let at = 0; at < cells.length; at += 1) if (cells[at] === undefined) cells[at] = '';
    if (cells.some((value) => String(value).trim() !== '')) rows.push(cells);
  }
  return rows;
}

/* ---------------------------------------------------------- the columns */

const INVOICE_HEADING = /\b(invoice|inv|document|doc|bill)\b|^(number|no\.?|#|ref(erence)?)$/i;
const CLIENT_HEADING = /\b(client|customer|supplier|vendor|company|account|name)\b/i;
/** A purchase order column: "PO", "PO Number", "Customer PO", "Purchase order". Not "Order". */
const PO_HEADING = /(^|[^a-z])p\.?\s?o\.?([^a-z]|$)|\bpurchase\s*order/i;

/** Could this cell be an invoice number? It has a digit and is not a long sentence. */
function valueLike(cell) {
  const text = String(cell ?? '').trim();
  return /\d/.test(text) && text.length <= 40 && !/\s{2,}/.test(text);
}

/**
 * A first guess at which column holds the invoice numbers, which the client
 * names, which the PO numbers, and whether the first row is a heading.
 *
 * @param {string[][]} rows
 * @returns {{ hasHeader: boolean, invoiceColumn: number, clientColumn: number|null,
 *   poColumn: number|null, headers: string[] }}
 */
export function guessColumns(rows = []) {
  const [first = []] = rows;
  const hasHeader =
    first.length > 0 &&
    first.every((cell) => !valueLike(cell) || /[a-z]{4,}/i.test(cell)) &&
    first.some((cell) => /[a-z]{2,}/i.test(cell));
  const width = Math.max(0, ...rows.map((row) => row.length));
  const headers = Array.from({ length: width }, (_, column) =>
    hasHeader
      ? String(first[column] ?? '').trim() || `Column ${column + 1}`
      : `Column ${column + 1}`
  );
  const body = hasHeader ? rows.slice(1) : rows;

  const poAt = hasHeader ? headers.findIndex((header) => PO_HEADING.test(header)) : -1;
  let invoiceColumn = hasHeader
    ? headers.findIndex((header, column) => column !== poAt && INVOICE_HEADING.test(header))
    : -1;
  if (invoiceColumn < 0) {
    let best = 0;
    let bestCount = -1;
    for (let column = 0; column < width; column += 1) {
      const count = body.filter((row) => valueLike(row[column])).length;
      if (count > bestCount) {
        best = column;
        bestCount = count;
      }
    }
    invoiceColumn = best;
  }
  const clientAt = hasHeader
    ? headers.findIndex(
        (header, column) =>
          column !== invoiceColumn && column !== poAt && CLIENT_HEADING.test(header)
      )
    : -1;
  return {
    hasHeader,
    invoiceColumn,
    clientColumn: clientAt >= 0 ? clientAt : null,
    poColumn: poAt >= 0 && poAt !== invoiceColumn ? poAt : null,
    headers,
  };
}

/* ----------------------------------------------------- the list itself */

/** How a number is compared: as detection writes it, without stray spaces. */
export function normalizeKnown(value) {
  return normalizeValue(
    String(value ?? '')
      .trim()
      .replace(/\s+/g, '')
  );
}

/**
 * Characters text recognition mixes up, and the one each is folded into for
 * comparing. Letters are folded into digits: "SO-80155" and "S0-80155" both
 * become "50-80155".
 */
const LOOK_ALIKES = { O: '0', Q: '0', D: '0', I: '1', L: '1', S: '5', B: '8', Z: '2', G: '6' };

/** A number with every look-alike letter written as the digit it resembles. */
export function lookAlikeKey(value) {
  return String(value).replace(/[OQDILSBZG]/g, (letter) => LOOK_ALIKES[letter]);
}

/** Are these two strings one edit apart: one character changed, added or dropped? */
export function oneEditApart(a, b) {
  if (a === b) return false;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (a.length > b.length) i += 1;
    else if (b.length > a.length) j += 1;
    else {
      i += 1;
      j += 1;
    }
  }
  return edits + (a.length - i) + (b.length - j) === 1;
}

/**
 * Turn the rows of a file into a list to check numbers against.
 *
 * @param {string[][]} rows
 * @param {{ invoiceColumn: number, clientColumn?: number|null, poColumn?: number|null,
 *   hasHeader: boolean }} choice
 * @param {string} [fileName]
 * @returns {{ fileName: string, hasPo: boolean,
 *   entries: Array<{ value: string, client: string, po: string }>,
 *   byValue: Map<string, object>, byLookAlike: Map<string, object[]> }}
 */
export function buildKnownList(rows, choice, fileName = '') {
  const { invoiceColumn, clientColumn = null, poColumn = null, hasHeader } = choice;
  const entries = [];
  const byValue = new Map();
  const byLookAlike = new Map();
  for (const row of hasHeader ? rows.slice(1) : rows) {
    const value = normalizeKnown(row[invoiceColumn]);
    if (!value || byValue.has(value)) continue;
    const entry = {
      value,
      client: clientColumn === null ? '' : String(row[clientColumn] ?? '').trim(),
      po: poColumn === null ? '' : String(row[poColumn] ?? '').trim(),
    };
    entries.push(entry);
    byValue.set(value, entry);
    const key = lookAlikeKey(value);
    byLookAlike.set(key, [...(byLookAlike.get(key) ?? []), entry]);
  }
  return { fileName, hasPo: poColumn !== null, entries, byValue, byLookAlike };
}

/**
 * Check one number against the list.
 *
 * - `verified`: the number is in the list.
 * - `near`: it is not, but exactly one entry is a look-alike of it (S for 5, O
 *   for 0 and so on, any number of them) or one character away from it. That
 *   entry is offered as the likely right number - never put in by itself.
 * - `unknown`: neither. Several entries close by count as unknown too: there is
 *   no telling which was meant.
 *
 * @param {string} value
 * @param {ReturnType<typeof buildKnownList>} list
 * @returns {{ status: 'verified'|'near'|'unknown', suggestion?: string,
 *   why?: 'look-alike'|'one-character' }}
 */
export function checkNumber(value, list) {
  const normal = normalizeKnown(value);
  if (!list || !normal) return { status: 'unknown' };
  if (list.byValue.has(normal)) return { status: 'verified' };

  const alike = (list.byLookAlike.get(lookAlikeKey(normal)) ?? []).filter(
    (entry) => entry.value !== normal
  );
  const close = new Map(alike.map((entry) => [entry.value, 'look-alike']));
  for (const entry of list.entries) {
    if (!close.has(entry.value) && oneEditApart(normal, entry.value)) {
      close.set(entry.value, 'one-character');
    }
  }
  if (close.size === 1) {
    const [[suggestion, why]] = close;
    return { status: 'near', suggestion, why };
  }
  return { status: 'unknown' };
}
