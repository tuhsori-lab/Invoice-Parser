/**
 * The rest of an invoice: who it is for, when it was issued, its terms, when it
 * is due, and how much.
 *
 * The invoice number is found by detect.js, which is built for values shaped
 * like one. These fields are shaped differently - "Sep 2, 2026", "Net 30",
 * "€1.297,48", a company name - so each has its own reader here, and each looks
 * for its value the way it is printed: after its label on the same line, or
 * under it when the label is a column heading.
 *
 * Invoices go to US and EU customers, so a date like 03/04/2026 can be read two
 * ways. A day over 12 settles it, so does a dotted date (always day first), and
 * otherwise the currency does: dollars month first, euros and pounds day first.
 * A date still ambiguous after that is marked so, to be checked against the
 * spreadsheet.
 */

/** Words that are the start of a label, so never a customer's name. */
const LABEL_WORDS = /^(invoice|date|terms|due|total|amount|balance|po\b|p\.o\.|page|tax|vat)/i;

/** How far apart two runs on one line can be and still be one phrase, in font sizes. */
const PHRASE_GAP = 1.2;

/** Lines below a heading searched for its value. */
const LINES_BELOW = 3;

/* ------------------------------------------------------------------ money */

const CURRENCIES = [
  ['EUR', /€|\bEUR\b/i],
  ['GBP', /£|\bGBP\b/i],
  ['CHF', /\bCHF\b/i],
  ['USD', /\$|\bUSD\b/i],
];

/**
 * An amount of money as printed: "$1,297.48", "€1.297,48", "1 297,48 EUR",
 * "(45.00)" for a credit.
 *
 * The last separator decides what it is: followed by one or two digits it is
 * the decimal point, by three it groups thousands.
 *
 * @param {string} raw
 * @returns {{ amount: number, currency: string|null }|null} null when it is not
 *   money - a bare whole number with no currency is taken for a count, not a sum.
 */
export function parseMoney(raw) {
  const text = String(raw ?? '').trim();
  const currency = CURRENCIES.find(([, pattern]) => pattern.test(text))?.[0] ?? null;
  const rest = text.replace(/€|£|\$|\b(EUR|GBP|CHF|USD)\b/gi, '').trim();
  if (!/^[-(]?\s*\d[\d.,'\s\u00a0]*\)?-?$/.test(rest)) return null;
  const negative = /^-|^\(|-$/.test(rest);
  const digits = rest.replace(/[^\d.,]/g, '');
  const last = Math.max(digits.lastIndexOf('.'), digits.lastIndexOf(','));
  const tail = last >= 0 ? digits.length - last - 1 : 0;
  const decimal = last >= 0 && tail >= 1 && tail <= 2;
  if (!decimal && !currency) return null;
  const whole = (decimal ? digits.slice(0, last) : digits).replace(/[.,]/g, '');
  const amount = Number(`${whole || '0'}${decimal ? `.${digits.slice(last + 1)}` : ''}`);
  if (!Number.isFinite(amount)) return null;
  return { amount: negative ? -amount : amount, currency };
}

/* ------------------------------------------------------------------ dates */

/** The first letters of month names in the languages invoices commonly use. */
const MONTHS = {
  jan: 1, ene: 1, gen: 1, jän: 1,
  feb: 2, fev: 2, fév: 2,
  mar: 3, mär: 3, mrt: 3,
  apr: 4, avr: 4, abr: 4,
  may: 5, mai: 5, mei: 5, mag: 5,
  jun: 6, giu: 6, juin: 6,
  jul: 7, lug: 7, juil: 7,
  aug: 8, ago: 8, aou: 8, aoû: 8,
  sep: 9, set: 9,
  oct: 10, okt: 10, ott: 10,
  nov: 11,
  dec: 12, dez: 12, dic: 12, déc: 12,
}; // prettier-ignore

function monthOf(word) {
  const lower = String(word).toLowerCase();
  return MONTHS[lower.slice(0, 4)] ?? MONTHS[lower.slice(0, 3)] ?? null;
}

const pad = (n) => String(n).padStart(2, '0');

/** A real calendar day as YYYY-MM-DD, or null. */
function isoOf(year, month, day) {
  const y = year < 100 ? 2000 + year : year;
  const date = new Date(Date.UTC(y, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${y}-${pad(month)}-${pad(day)}`;
}

/**
 * A date as printed, in any of the usual ways.
 *
 * @param {string} raw
 * @param {'mdy'|'dmy'|null} [order] - which way round an all-numbers date is,
 *   when nothing in the date itself says.
 * @returns {{ iso: string, ambiguous: boolean }|null}
 */
export function parseDate(raw, order = null) {
  const text = String(raw ?? '').trim();

  const iso = /\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/.exec(text);
  if (iso) {
    const found = isoOf(+iso[1], +iso[2], +iso[3]);
    return found && { iso: found, ambiguous: false };
  }

  const dayFirst =
    /\b(\d{1,2})(?:st|nd|rd|th)?[\s./-]*(?:of\s+)?([A-Za-zÀ-ÿ]{3,})\.?[\s,./-]*(\d{4}|\d{2})\b/.exec(
      text
    );
  if (dayFirst && monthOf(dayFirst[2])) {
    const found = isoOf(+dayFirst[3], monthOf(dayFirst[2]), +dayFirst[1]);
    if (found) return { iso: found, ambiguous: false };
  }
  // A scan can lose the space: "Oct1, 2026".
  const monthFirst = /\b([A-Za-zÀ-ÿ]{3,}?)\.?[\s-]*(\d{1,2})(?:st|nd|rd|th)?[\s,-]+(\d{4})\b/.exec(
    text
  );
  if (monthFirst && monthOf(monthFirst[1])) {
    const found = isoOf(+monthFirst[3], monthOf(monthFirst[1]), +monthFirst[2]);
    if (found) return { iso: found, ambiguous: false };
  }

  const numeric = /\b(\d{1,2})([./-])(\d{1,2})\2(\d{4}|\d{2})\b/.exec(text);
  if (numeric) {
    const [a, b, year] = [+numeric[1], +numeric[3], +numeric[4]];
    let way = order;
    let ambiguous = false;
    if (numeric[2] === '.' || a > 12) way = 'dmy';
    else if (b > 12) way = 'mdy';
    else if (a !== b) ambiguous = !order;
    way ??= 'mdy';
    const found = way === 'dmy' ? isoOf(year, b, a) : isoOf(year, a, b);
    return found && { iso: found, ambiguous };
  }
  return null;
}

/** Which way round an all-numbers date is most likely written, by the currency. */
export function dateOrderFor(currency) {
  if (currency === 'USD') return 'mdy';
  if (currency) return 'dmy';
  return null;
}

/** A YYYY-MM-DD date moved on by some days. */
export function addDays(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Days from one YYYY-MM-DD date to another: positive when `to` is later. */
export function daysBetween(from, to) {
  const at = (iso) => Date.UTC(...iso.split('-').map((n, i) => Number(n) - (i === 1 ? 1 : 0)));
  return Math.round((at(to) - at(from)) / 86_400_000);
}

/* ------------------------------------------------------------------ terms */

const DAY_WORDS = 'days?|tage|jours|d[ií]as|dagen|giorni|dias';

/**
 * Payment terms as printed: "Net 30", "N30", "30 days", "2/10 Net 30", "Net 30
 * EOM", "Due on receipt".
 *
 * @param {string} raw
 * @returns {{ days: number, eom: boolean }|null} `eom` when the days run from
 *   the end of the month the invoice is dated in.
 */
export function parseTerms(raw) {
  const text = String(raw ?? '').toLowerCase();
  const eom = /\beom\b|end of (the )?month/.test(text);
  if (/(due|payable)\s+(up)?on\s+receipt|upon receipt|\bimmediate|\bc\.?o\.?d\b/.test(text)) {
    return { days: 0, eom: false };
  }
  const net = /\bnet\s*-?\s*(\d{1,3})\b|\bn(\d{2,3})\b/.exec(text);
  if (net) return { days: Number(net[1] ?? net[2]), eom };
  const days = new RegExp(`\\b(\\d{1,3})\\s*(${DAY_WORDS})\\b`).exec(text);
  if (days) return { days: Number(days[1]), eom };
  return null;
}

/**
 * When an invoice falls due: its date plus its terms, from the end of that
 * month for EOM terms.
 *
 * @param {string|null} dateIso
 * @param {{ days: number, eom: boolean }|null} terms
 * @returns {string|null}
 */
export function dueDateFor(dateIso, terms) {
  if (!dateIso || !terms) return null;
  if (!terms.eom) return addDays(dateIso, terms.days);
  const [y, m] = dateIso.split('-').map(Number);
  const monthEnd = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return addDays(monthEnd, terms.days);
}

/* ------------------------------------------------------------- on a page */

/**
 * A page's text as phrases: runs on one line close enough together to be read
 * as one piece, each with where it sat.
 */
function phrasesOf(page) {
  const text = page.text ?? '';
  if (!page.layout?.length) {
    // No positions: every line is one phrase, in order.
    return text.split('\n').map((line, band) => ({ text: line, x: 0, endX: 0, band }));
  }
  const runs = [...page.layout].sort((a, b) => a.band - b.band || a.x - b.x);
  const phrases = [];
  for (const run of runs) {
    const piece = text.slice(run.start, run.end);
    const last = phrases.at(-1);
    if (last && last.band === run.band && run.x - last.endX < PHRASE_GAP * (run.fontSize || 10)) {
      last.text = `${last.text}${run.start > last.end ? ' ' : ''}${piece}`.replace(/\s+/g, ' ');
      last.endX = Math.max(last.endX, run.endX);
      last.end = run.end;
    } else {
      phrases.push({ text: piece.trim(), x: run.x, endX: run.endX, band: run.band, end: run.end });
    }
  }
  return phrases.filter((phrase) => phrase.text);
}

/**
 * The values printed with a label, nearest first: the rest of the label's own
 * phrase, the next phrase along its line, then what stands under it.
 *
 * @param {Array<object>} phrases
 * @param {RegExp} label - anchored at the start of a phrase.
 * @param {{ right?: boolean, below?: boolean }} [where]
 * @returns {Array<{ text: string, band: number }>}
 */
function valuesFor(phrases, label, { right = true, below = true } = {}) {
  const found = [];
  for (const phrase of phrases) {
    const match = label.exec(phrase.text);
    if (!match) continue;
    const rest = phrase.text.slice(match[0].length).replace(/^[\s:#.-]+/, '');
    if (rest) found.push({ text: rest, band: phrase.band });
    if (right) {
      const next = phrases.find((other) => other.band === phrase.band && other.x > phrase.endX);
      if (next) found.push({ text: next.text, band: phrase.band });
    }
    if (below) {
      const under = phrases.find(
        (other) =>
          other.band > phrase.band &&
          other.band <= phrase.band + LINES_BELOW &&
          other.x < phrase.endX + 20 &&
          other.endX > phrase.x - 20
      );
      if (under) found.push({ text: under.text, band: under.band });
    }
  }
  return found;
}

const DATE_LABEL =
  /^(invoice date|date of invoice|issue date|date of issue|date issued|invoice dt\.?|billing date|rechnungsdatum|date de facturation|fecha( de factura)?|data fattura|factuurdatum|datum|date(?!\s+(due|paid|of payment)))\b\s*:?/i;
const DUE_LABEL =
  /^(due date|payment due( date)?|date due|due by|due|fällig(keit)?|échéance|vencimiento|vervaldatum)\b\s*:?/i;
const TERMS_LABEL =
  /^((payment )?terms( of payment)?|zahlungsbedingungen|conditions de paiement|condiciones de pago|betalingsvoorwaarden)\b\s*:?/i;
const CUSTOMER_LABEL =
  /^(bill(ed)?[ -]to|invoice to|sold to|ship(ped)? to|customer(?!\s*(id|no\b|number|#|code|ref|account))|client(?!\s*(id|no\b|number|#|code|ref|account))|kunde|rechnungsempfänger|facturé à|cliente|klant)\b\s*:?/i;

/** Total labels, most telling first: what is owed beats a plain "Total". */
const TOTAL_LABELS = [
  // Spaces optional: text read from a scan often runs words together ("Totaldue").
  /^(total\s*(amount\s*)?due|amount\s*due|balance\s*due|total\s*payable|amount\s*payable|balance)\b\s*:?/i,
  /^(invoice total|grand total|total amount|total (incl\.?|including) (vat|tax)|total \(?(usd|eur|gbp|chf)\)?|gesamtbetrag|montant total|importe total|totale|totaal)\b\s*:?/i,
  /^total\b(?!\s*(vat|tax|excl|before|net\b|ht\b|qty|quantity|items|hours|weight))\s*:?/i,
];

/** The first of these values a reader can make sense of. */
function firstParsed(values, parse) {
  for (const { text } of values) {
    const parsed = parse(text);
    if (parsed) return { ...parsed, raw: text };
  }
  return null;
}

/** A purchase order reference, as printed: "PO-4500118", "PO 55103388", "PC-7790". */
const PO_LABEL =
  /^(purchase\s*order(\s*(no\.?|number|#|ref(erence)?))?|customer\s*po|p\.?\s?o\.?(?!\s*box\b)\s*(no\.?|number|#|ref(erence)?)?|order\s*(no\.?|number|#|ref(erence)?)|bestellnummer|bon de commande)\b\s*:?/i;

/** A PO number: a short reference with a digit in it, not a date or a sum of money. */
function asPo(text) {
  const value = String(text ?? '')
    .trim()
    .replace(/[.,;]$/, '');
  if (value.length < 2 || value.length > 30 || !/\d/.test(value)) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9 ./_#-]*$/.test(value) || value.split(/\s+/).length > 3) return null;
  if (parseDate(value) || /\d[.,]\d{2}$/.test(value)) return null;
  return { value };
}

/**
 * A PO number reduced to what identifies it, for comparing: no spaces or
 * punctuation, and no "PO" in front, so "PO 55103388", "PO-55103388" and
 * "55103388" are the same order.
 *
 * @param {string|null|undefined} po
 * @returns {string}
 */
export function poKey(po) {
  return String(po ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/^PO(?=\d)/, '');
}

/** A customer's name: words, not a label, not a number. */
function asName(text) {
  const name = String(text ?? '').trim();
  if (name.length < 2 || name.length > 80) return null;
  if (!/[A-Za-zÀ-ÿ]{2}/.test(name) || LABEL_WORDS.test(name)) return null;
  return { name };
}

/**
 * Everything but the number, read from an invoice's pages: customer, PO,
 * total, date, terms and due date.
 *
 * The total is the most telling one on any page, the last when there are
 * several (a running total on page one, the real one on the last page). The
 * rest come from the first page that has them.
 *
 * @param {Array<{ text: string, layout?: Array<object> }>} pages - one invoice's, in order.
 * @returns {{
 *   customer: string|null,
 *   po: { value: string, raw: string }|null,
 *   total: { amount: number, currency: string|null, raw: string }|null,
 *   date: { iso: string, ambiguous: boolean, raw: string }|null,
 *   terms: { days: number, eom: boolean, raw: string }|null,
 *   due: { iso: string, ambiguous: boolean, raw: string }|null,
 *   dueDate: string|null,
 * }}
 */
export function readFields(pages = []) {
  const phrasesByPage = pages.map(phrasesOf);

  let total = null;
  let rank = Infinity;
  phrasesByPage.forEach((phrases) => {
    TOTAL_LABELS.forEach((label, at) => {
      if (at > rank) return;
      const found = firstParsed(valuesFor(phrases, label, { below: false }).reverse(), parseMoney);
      if (found) {
        total = found;
        rank = at;
      }
    });
  });

  const order = dateOrderFor(total?.currency ?? null);
  const first = (read) => {
    for (const phrases of phrasesByPage) {
      const found = read(phrases);
      if (found) return found;
    }
    return null;
  };
  const date = first((phrases) =>
    firstParsed(valuesFor(phrases, DATE_LABEL), (text) => parseDate(text, order))
  );
  const due = first((phrases) =>
    firstParsed(valuesFor(phrases, DUE_LABEL), (text) => parseDate(text, order))
  );
  const terms =
    first((phrases) => firstParsed(valuesFor(phrases, TERMS_LABEL), parseTerms)) ??
    // Terms often sit in a sentence at the foot: "Payment within 30 days".
    first((phrases) =>
      firstParsed(
        phrases.filter((phrase) =>
          /\bnet\s*\d|\bwithin\s+\d+\s+days|on receipt|\beom\b/i.test(phrase.text)
        ),
        parseTerms
      )
    );
  const po = first((phrases) => firstParsed(valuesFor(phrases, PO_LABEL), asPo));
  const customer =
    phrasesByPage.length > 0
      ? (firstParsed(valuesFor(phrasesByPage[0], CUSTOMER_LABEL, { right: false }), asName)?.name ??
        null)
      : null;

  return {
    customer,
    po: po ? { value: po.value, raw: po.raw } : null,
    total,
    date,
    terms,
    due,
    dueDate: due?.iso ?? dueDateFor(date?.iso ?? null, terms),
  };
}
