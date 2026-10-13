/**
 * What each client's numbers look like (their shape, and a prefix they all
 * share), learned from numbers known to be right. Never a number itself.
 *
 * Kept in localStorage, which stays in this browser and is never sent anywhere.
 * A browser that will not keep it simply starts afresh.
 */

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

/** What each client's numbers look like, by box id. */
export function loadLearnedShapes() {
  const saved = read(LEARNED_KEY, {});
  return saved && typeof saved === 'object' ? saved : {};
}

export function saveLearnedShapes(learned) {
  write(LEARNED_KEY, learned);
}
