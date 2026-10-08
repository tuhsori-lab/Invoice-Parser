/**
 * Running detection over every page of a batch.
 *
 * This is the step between reading the text out of the PDFs and deciding which
 * pages belong together: for each page it works out which client profile
 * recognises it, which invoice number it carries, where that number was found,
 * and any extra field worth putting in the file name.
 *
 * It never touches the PDF itself, so it can be re-run as often as the user
 * changes a setting without re-reading a single byte.
 */

import {
  detectCandidates,
  detectFieldValue,
  detectPurchaseOrder,
  commonLabelPattern,
  hasConflict,
  mendMisreadLabels,
  readPageMarker,
  readingsAgree,
  valueConfidence,
} from './detect.js';
import { labelsForPage, zonesForPage } from './profiles.js';

/**
 * @typedef {object} ExtractedPage
 * @property {number} index 1-based position in the whole batch.
 * @property {string} fileId which source file this page came from.
 * @property {string} fileName the source file's name, for display and the CSV.
 * @property {number} filePageIndex 0-based page number inside that source file.
 * @property {string} text the page's text.
 * @property {boolean} hasText false when the page has no usable text layer.
 * @property {Array<object>} [layout] where each run of the text sat on the page.
 * @property {number} [pageWidth] the page's own width, for reading a saved spot.
 * @property {number} [pageHeight] the page's own height.
 * @property {boolean} [ocr] true when the text came from text recognition.
 */

/**
 * @typedef {object} AnalyzedPage
 * @property {{ value: string, label: string, source: string }|null} detection
 * @property {Array<object>} candidates every number the page offered.
 * @property {boolean} conflict two different numbers after two different labels.
 * @property {{ value: string, label: string }|null} extra
 * @property {{ value: string, label: string }|null} po the purchase order number.
 * @property {string} client the name of the profile that recognised this page.
 * @property {Array<object>} matchedProfiles
 */

/** What each way of reading a box on its own is called, for a person. */
const BOX_READING_NAMES = [
  'the box, read close up',
  'the box, read larger',
  'the box, read in grey',
];

/**
 * Bring in the readings of a client's box taken on its own (see lib/ocr.js).
 *
 * Readings that agree with the page's own reading of the box back it up.
 * Readings that agree with each other stand in for it when the page's own
 * reading found nothing there. Readings that say something else are added as
 * numbers the page offers, so the page is flagged and a person sees all of
 * them - nothing is chosen between quietly.
 *
 * @param {Array<object>} candidates - what detection found on the page.
 * @param {{ name: string, readings: Array<{ value: string|null, confidence: number|null }> }} box
 * @returns {{ candidates: Array<object>, agree: boolean, confidence: number|null }}
 */
export function withBoxReadings(candidates, box) {
  const readings = (box?.readings ?? []).map((reading, at) => ({ ...reading, at }));
  const read = readings.filter((reading) => reading.value);
  if (read.length === 0) return { candidates, agree: false, confidence: null };

  const values = [...new Set(read.map((reading) => reading.value))];
  const sureOf = (value) => {
    const scores = read
      .filter((reading) => reading.value === value && typeof reading.confidence === 'number')
      .map((reading) => reading.confidence);
    return scores.length ? Math.min(...scores) : null;
  };
  const zone = candidates.find((hit) => hit.source === 'zone');

  if (values.length === 1) {
    const [value] = values;
    if (zone?.value === value) return { candidates, agree: true, confidence: sureOf(value) };
    if (zone) {
      return {
        candidates: [
          ...candidates,
          { value, label: BOX_READING_NAMES[read[0].at], source: 'box-crop' },
        ],
        agree: false,
        confidence: null,
      };
    }
    return {
      candidates: [{ value, label: box.name || 'this client', source: 'zone' }, ...candidates],
      agree: read.length >= 2,
      confidence: sureOf(value),
    };
  }

  // The readings disagree with each other: every one of them is shown.
  const extra = values
    .filter((value) => value !== zone?.value)
    .map((value) => {
      const first = read.find((reading) => reading.value === value);
      return { value, label: BOX_READING_NAMES[first.at], source: 'box-crop' };
    });
  return {
    candidates: zone ? [...candidates, ...extra] : [...extra, ...candidates],
    agree: false,
    confidence: null,
  };
}

/**
 * Detect on every page.
 *
 * @param {ExtractedPage[]} pages
 * @param {object} [settings]
 * @param {Array<object>} [settings.profiles] active client profiles, in order.
 * @param {boolean} [settings.useCommonLabels]
 * @param {boolean} [settings.useBareInvoice]
 * @param {string} [settings.customPattern]
 * @param {string} [settings.extraLabel] a batch-wide extra field, such as "PO #".
 * @returns {Array<ExtractedPage & AnalyzedPage>}
 */
export function analyzePages(pages = [], settings = {}) {
  const {
    profiles = [],
    useCommonLabels = true,
    useBareInvoice = true,
    customPattern = '',
    extraLabel = '',
  } = settings;

  return pages.map((page) => {
    const text = page.text ?? '';
    // Where each run sat on the page, so a value can be told from a coincidence
    // standing at the same height. Pages read by text recognition have one too.
    const layout = page.layout ?? null;
    // Text read from a scan is a little different every time, so a client's
    // letterhead is allowed a misread letter or two there.
    const matching = { tolerant: Boolean(page.ocr) };
    const { labels, matched, client } = labelsForPage(text, profiles, matching);
    const candidates = detectCandidates(text, {
      profileLabels: labels,
      useCommonLabels,
      useBareInvoice,
      customPattern,
      layout,
      scanned: Boolean(page.ocr),
      zones: zonesForPage(text, profiles, matching),
      pageSize:
        page.pageWidth && page.pageHeight
          ? { width: page.pageWidth, height: page.pageHeight }
          : null,
    });
    const extraLabels = [
      ...matched.map((profile) => profile.extraLabel).filter(Boolean),
      extraLabel,
    ].filter(Boolean);

    // A scanned page whose client's box was also read on its own.
    const boxed = page.boxReadings
      ? withBoxReadings(candidates, page.boxReadings)
      : { candidates, agree: false, confidence: null };
    const offered = boxed.candidates;
    const [best = null] = offered;
    // How sure text recognition was of the number - only a scan says. A clean
    // reading of the box on its own counts when it is the surer of the two.
    const pageScore = best && page.ocr ? valueConfidence(text, layout, best.value) : null;
    const detection =
      best && page.ocr
        ? {
            ...best,
            confidence:
              boxed.confidence === null ? pageScore : Math.max(boxed.confidence, pageScore ?? 0),
          }
        : best;

    return {
      ...page,
      detection,
      candidates: offered,
      conflict: hasConflict(offered),
      // Two ways of reading the page found the same number.
      agreement: readingsAgree(offered),
      // The box, read on its own several ways, agreed.
      readingsAgree: boxed.agree,
      // A scanned page that looks as if it has a number of its own - a label
      // for one, or print in the client's box - but none could be read. Kept
      // with the invoice before it, and flagged, rather than quietly joined.
      unreadNumber:
        Boolean(page.ocr) &&
        offered.length === 0 &&
        (new RegExp(commonLabelPattern(), 'i').test(mendMisreadLabels(text)) ||
          Boolean(page.boxReadings?.readings?.some((reading) => reading.ink))),
      // "Page 2 of 3", when the page says so.
      pageOf: readPageMarker(text),
      extra: extraLabels.length ? detectFieldValue(text, extraLabels, { layout }) : null,
      // Always looked for: it costs next to nothing, and whether the list of
      // them is shown is a question of display that should not re-read a page.
      po: detectPurchaseOrder(text, { layout }),
      client,
      matchedProfiles: matched,
    };
  });
}

/**
 * What one reading of a scanned page gives: the invoice number the usual rules
 * find in it, and how sure text recognition was of that number.
 *
 * Used to choose between two readings of the same page, so it goes through
 * exactly the detection every other page does - a box drawn for the client, the
 * everyday labels, the user's own pattern.
 *
 * @param {ExtractedPage} page - the page as it was before it was read.
 * @param {{ text: string, layout: Array<object>|null }} reading - what was read.
 * @param {object} [settings] - as for analyzePages.
 * @returns {{ value: string|null, confidence: number|null }}
 */
export function judgeReading(page, reading, settings = {}) {
  const [read] = analyzePages([{ ...page, ...reading, ocr: true }], settings);
  const value = read.detection?.value ?? null;
  return { value, confidence: value ? valueConfidence(read.text, read.layout, value) : null };
}
