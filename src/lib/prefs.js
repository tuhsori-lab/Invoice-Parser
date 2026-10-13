/**
 * Small choices remembered in this browser: which tab was open last.
 *
 * Every key this app keeps starts with "invoice-splitter." - the app's name when
 * it was first written. They are kept as they were, so nobody loses the boxes,
 * shapes and settings they had before it was called Invoice Hub.
 */

const PREFIX = 'invoice-splitter.';
const TAB_KEY = `${PREFIX}tab.v1`;

/** The tabs there are, in order. */
export const TABS = ['split', 'reconcile', 'settings'];

/** The tab open last time, or the first one. */
export function loadTab() {
  try {
    const saved = window.localStorage.getItem(TAB_KEY);
    return TABS.includes(saved) ? saved : TABS[0];
  } catch {
    return TABS[0];
  }
}

/** Remember the open tab. */
export function saveTab(tab) {
  try {
    window.localStorage.setItem(TAB_KEY, tab);
  } catch {
    // Not remembered, but still open for this visit.
  }
}

/**
 * Forget everything this app has kept in this browser: boxes, learned shapes,
 * column choices, counts, theme and tab.
 *
 * @returns {number} how many things were forgotten.
 */
export function forgetEverything() {
  try {
    const keys = [];
    for (let at = 0; at < window.localStorage.length; at += 1) {
      const key = window.localStorage.key(at);
      if (key?.startsWith(PREFIX)) keys.push(key);
    }
    for (const key of keys) window.localStorage.removeItem(key);
    return keys.length;
  } catch {
    return 0;
  }
}

const PREFIXES_KEY = `${PREFIX}reconcile-prefixes.v1`;

/** The prefixes Reconcile takes off before matching, as written in Settings, or null. */
export function loadPrefixes() {
  try {
    return window.localStorage.getItem(PREFIXES_KEY);
  } catch {
    return null;
  }
}

/** Remember them; nothing (or the defaults) forgets them. */
export function savePrefixes(written) {
  try {
    if (written === null) window.localStorage.removeItem(PREFIXES_KEY);
    else window.localStorage.setItem(PREFIXES_KEY, written);
  } catch {
    // Used for this visit only.
  }
}
