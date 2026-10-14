/**
 * What the Reconcile tab was taught - the labels a PO or amount is printed
 * after, and the shape of each customer's POs - remembered in this browser so
 * the next batch is read with them too.
 */

const KEY = 'invoice-splitter.learned-labels.v1';

/**
 * @returns {{ po: string[], total: string[],
 *   poPatterns: Record<string, { name: string, patterns: string[] }> }}
 */
export function loadLearned() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(KEY) ?? '{}');
    const list = (value) =>
      Array.isArray(value) ? value.filter((entry) => typeof entry === 'string') : [];
    const poPatterns = {};
    for (const [key, entry] of Object.entries(saved.poPatterns ?? {})) {
      if (typeof entry?.name === 'string') {
        poPatterns[key] = { name: entry.name, patterns: list(entry.patterns) };
      }
    }
    return { po: list(saved.po), total: list(saved.total), poPatterns };
  } catch {
    return { po: [], total: [], poPatterns: {} };
  }
}

/** Nothing learned. */
export const NOTHING_LEARNED = { po: [], total: [], poPatterns: {} };

export function saveLearned(learned) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(learned));
  } catch {
    // Learned for this visit only.
  }
}
