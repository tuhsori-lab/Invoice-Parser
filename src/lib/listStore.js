/**
 * What is remembered, in this browser, about checking invoices.
 *
 * - Which columns of the invoice list hold the numbers and the client names,
 *   by their headings, so the next list exported the same way loads in one go.
 * - What each client's numbers look like (their shape, and a prefix they all
 *   share), learned from numbers known to be right. Never a number itself.
 *
 * Kept in localStorage, which stays in this browser and is never sent anywhere.
 * A browser that will not keep it simply starts afresh.
 */

const COLUMNS_KEY = 'invoice-splitter.list-columns.v1';
const LEARNED_KEY = 'invoice-splitter.learned-shapes.v1';

function read(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Not remembered, but still in use for this visit.
  }
}

/** The headings chosen last time: { invoice: string, client: string|null }. */
export function loadColumnChoice() {
  const saved = read(COLUMNS_KEY, null);
  return saved && typeof saved.invoice === 'string' ? saved : null;
}

export function saveColumnChoice(choice) {
  write(COLUMNS_KEY, { invoice: choice.invoice, client: choice.client ?? null });
}

/** What each client's numbers look like, by box id. */
export function loadLearnedShapes() {
  const saved = read(LEARNED_KEY, {});
  return saved && typeof saved === 'object' ? saved : {};
}

export function saveLearnedShapes(learned) {
  write(LEARNED_KEY, learned);
}
