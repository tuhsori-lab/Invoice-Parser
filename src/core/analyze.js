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

import { detectCandidates, detectFieldValue, hasConflict } from './detect.js';
import { labelsForPage } from './profiles.js';

/**
 * @typedef {object} ExtractedPage
 * @property {number} index 1-based position in the whole batch.
 * @property {string} fileId which source file this page came from.
 * @property {string} fileName the source file's name, for display and the CSV.
 * @property {number} filePageIndex 0-based page number inside that source file.
 * @property {string} text the page's text.
 * @property {boolean} hasText false when the page has no usable text layer.
 * @property {boolean} [ocr] true when the text came from text recognition.
 */

/**
 * @typedef {object} AnalyzedPage
 * @property {{ value: string, label: string, source: string }|null} detection
 * @property {Array<object>} candidates every number the page offered.
 * @property {boolean} conflict two different numbers after two different labels.
 * @property {{ value: string, label: string }|null} extra
 * @property {string} client the name of the profile that recognised this page.
 * @property {Array<object>} matchedProfiles
 */

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
    const { labels, matched, client } = labelsForPage(text, profiles);
    const candidates = detectCandidates(text, {
      profileLabels: labels,
      useCommonLabels,
      useBareInvoice,
      customPattern,
    });
    const extraLabels = [
      ...matched.map((profile) => profile.extraLabel).filter(Boolean),
      extraLabel,
    ].filter(Boolean);

    return {
      ...page,
      detection: candidates[0] ?? null,
      candidates,
      conflict: hasConflict(candidates),
      extra: extraLabels.length ? detectFieldValue(text, extraLabels) : null,
      client,
      matchedProfiles: matched,
    };
  });
}
