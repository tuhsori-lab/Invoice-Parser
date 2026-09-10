/**
 * Deciding which pages belong to which invoice.
 *
 * Three ways of splitting are offered, because no single one fits every batch:
 *
 *   by-number  pages that carry the same invoice number belong together
 *   by-marker  a new invoice starts wherever a phrase appears, e.g. "Page 1 of"
 *   every-n    a fixed number of pages per invoice
 *
 * Pages with no number of their own are either treated as the continuation of
 * the invoice before them, or set aside for a person to look at - the user
 * chooses which, because both are right some of the time.
 *
 * Anything the user has fixed by hand is passed in as `overrides` and wins over
 * everything detection decided, so manual work survives a change of settings.
 */

export const SPLIT_MODES = ['by-number', 'by-marker', 'every-n'];
export const UNNUMBERED_MODES = ['attach', 'review'];

/** Every review flag this module can raise, with the words shown to a person. */
export const FLAG_LABELS = {
  'no-number': 'No invoice number found',
  fallback: 'Number found from the word "Invoice" alone',
  conflict: 'Two different invoice numbers on one page',
  'duplicate-name': 'Two invoices would be saved under the same name',
  ocr: 'Text was read from a scan, so it may be wrong',
};

/**
 * @typedef {object} GroupSettings
 * @property {'by-number'|'by-marker'|'every-n'} [mode]
 * @property {'attach'|'review'} [unnumbered] what to do with pages that carry no number.
 * @property {boolean} [combinePages] put pages sharing a number together even when apart.
 * @property {string} [markerText] the phrase that starts a new invoice in by-marker mode.
 * @property {number} [pagesPerInvoice] how many pages per invoice in every-n mode.
 * @property {object} [overrides] manual fixes, see {@link applyOverrides}.
 */

/** Text with its whitespace flattened, for a forgiving "contains" test. */
function flatten(text) {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/** The id a group gets from the page it starts on. Stable across re-detection. */
function groupIdFor(page) {
  return `g${page.index}`;
}

/** Start a new group at this page. */
function openGroup(page) {
  return {
    id: groupIdFor(page),
    invoice: null,
    pages: [],
    continuationPages: [],
    extra: null,
    provenance: null,
    client: '',
    flags: [],
    manual: false,
  };
}

/** Add a page to a group, remembering whether it carried a number of its own. */
function addPage(group, page, { continuation = false } = {}) {
  // The page a group starts on is never a continuation of anything.
  const isContinuation = continuation && group.pages.length > 0;
  group.pages.push(page);
  if (isContinuation) group.continuationPages.push(page.index);
  if (!group.invoice && page.detection?.value) {
    group.invoice = page.detection.value;
    group.provenance = {
      label: page.detection.label,
      source: page.detection.source,
      pageIndex: page.index,
    };
  }
  if (!group.extra && page.extra?.value) group.extra = page.extra;
  if (!group.client && page.client) group.client = page.client;
}

/** Pages that share a number, kept together even when they are not neighbours. */
function combineByNumber(groups) {
  const byNumber = new Map();
  const out = [];
  for (const group of groups) {
    const key = group.invoice;
    if (!key) {
      out.push(group);
      continue;
    }
    const existing = byNumber.get(key);
    if (!existing) {
      byNumber.set(key, group);
      out.push(group);
      continue;
    }
    existing.pages.push(...group.pages);
    existing.continuationPages.push(...group.continuationPages);
    existing.pages.sort((a, b) => a.index - b.index);
    if (!existing.extra && group.extra) existing.extra = group.extra;
  }
  return out;
}

/**
 * Group pages by the invoice number printed on them.
 *
 * @param {Array<object>} pages
 * @param {GroupSettings} settings
 * @param {(page: object) => 'split'|'join'|undefined} boundaryFor
 */
function groupByNumber(pages, settings, boundaryFor) {
  const { unnumbered = 'attach' } = settings;
  const groups = [];
  let current = null;
  let reviewGroup = null;

  for (const page of pages) {
    const value = page.detection?.value ?? null;
    const boundary = boundaryFor(page);

    if (boundary === 'split') {
      current = openGroup(page);
      groups.push(current);
      reviewGroup = null;
      addPage(current, page, { continuation: !value });
      continue;
    }

    if (boundary === 'join' && (current || reviewGroup)) {
      const target = current ?? reviewGroup;
      addPage(target, page, { continuation: !value });
      continue;
    }

    if (value) {
      if (!current || current.invoice !== value) {
        current = openGroup(page);
        groups.push(current);
      }
      reviewGroup = null;
      addPage(current, page);
      continue;
    }

    // No number on this page.
    if (unnumbered === 'attach' && current) {
      addPage(current, page, { continuation: true });
      continue;
    }
    if (reviewGroup) {
      addPage(reviewGroup, page, { continuation: true });
      continue;
    }
    reviewGroup = openGroup(page);
    groups.push(reviewGroup);
    addPage(reviewGroup, page, { continuation: unnumbered === 'attach' });
    if (unnumbered === 'review') current = null;
  }

  return settings.combinePages ? combineByNumber(groups) : groups;
}

/**
 * Group pages by a phrase that marks the first page of an invoice.
 */
function groupByMarker(pages, settings, boundaryFor) {
  const marker = flatten(settings.markerText ?? '');
  const groups = [];
  let current = null;

  for (const page of pages) {
    const boundary = boundaryFor(page);
    const starts =
      boundary === 'split' ||
      (boundary !== 'join' && marker && flatten(page.text).includes(marker));
    if (!current || starts) {
      current = openGroup(page);
      groups.push(current);
    }
    addPage(current, page, { continuation: !page.detection?.value && current.pages.length > 0 });
  }
  return groups;
}

/**
 * Group pages in fixed-size runs.
 */
function groupEveryN(pages, settings, boundaryFor) {
  const size = Math.max(1, Math.floor(settings.pagesPerInvoice ?? 1));
  const groups = [];
  let current = null;
  let countInGroup = 0;

  for (const page of pages) {
    const boundary = boundaryFor(page);
    const starts =
      boundary === 'split' || (boundary !== 'join' && (!current || countInGroup >= size));
    if (starts || !current) {
      current = openGroup(page);
      groups.push(current);
      countInGroup = 0;
    }
    addPage(current, page, { continuation: !page.detection?.value && countInGroup > 0 });
    countInGroup += 1;
  }
  return groups;
}

/**
 * Apply the fixes a person made by hand.
 *
 * `overrides.boundaries` maps a page number to 'split' (start a new invoice
 * here) or 'join' (this page belongs with the one before it). `overrides.numbers`
 * maps a group id to an invoice number typed by the user. Both are applied on
 * top of whatever detection decided, so changing a setting never throws manual
 * work away.
 *
 * @param {Array<object>} groups
 * @param {object} overrides
 */
function applyNumberOverrides(groups, overrides = {}) {
  const numbers = overrides.numbers ?? {};
  for (const group of groups) {
    const typed = numbers[group.id];
    if (typeof typed !== 'string') continue;
    const value = typed.trim();
    group.invoice = value || null;
    group.manual = true;
    group.provenance = value ? { label: 'typed by you', source: 'manual', pageIndex: null } : null;
  }
  return groups;
}

/** Work out which review flags a finished group deserves. */
function flagGroup(group) {
  const flags = [];
  if (!group.invoice) flags.push('no-number');
  if (group.provenance?.source === 'bare') flags.push('fallback');
  if (group.pages.some((page) => page.conflict)) flags.push('conflict');
  if (group.pages.some((page) => page.ocr)) flags.push('ocr');
  group.flags = flags;
  return group;
}

/**
 * Split a batch of pages into invoices.
 *
 * @param {Array<object>} pages - pages that have already been through analyze.js.
 * @param {GroupSettings} [settings]
 * @returns {Array<object>} groups in page order.
 */
export function groupPages(pages = [], settings = {}) {
  const mode = SPLIT_MODES.includes(settings.mode) ? settings.mode : 'by-number';
  const boundaries = settings.overrides?.boundaries ?? {};
  const boundaryFor = (page) => boundaries[page.index];

  let groups;
  if (mode === 'by-marker') groups = groupByMarker(pages, settings, boundaryFor);
  else if (mode === 'every-n') groups = groupEveryN(pages, settings, boundaryFor);
  else groups = groupByNumber(pages, settings, boundaryFor);

  applyNumberOverrides(groups, settings.overrides);
  groups.forEach((group) => flagGroup(group));
  return groups;
}

/**
 * The page numbers of a group, in order.
 *
 * @param {object} group
 * @returns {number[]}
 */
export function pageNumbersOf(group) {
  return group.pages.map((page) => page.index);
}

/**
 * Every group that needs a person to look at it.
 *
 * @param {Array<object>} groups
 * @returns {Array<object>}
 */
export function groupsNeedingReview(groups = []) {
  return groups.filter((group) => group.flags.length > 0);
}
