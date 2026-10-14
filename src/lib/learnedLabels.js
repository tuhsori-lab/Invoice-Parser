/**
 * Labels taught on the Reconcile tab - where a supplier prints its PO or its
 * amount - remembered in this browser so the next batch is read with them too.
 */

const KEY = 'invoice-splitter.learned-labels.v1';

/** @returns {{ po: string[], total: string[] }} */
export function loadLearned() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(KEY) ?? '{}');
    const list = (value) =>
      Array.isArray(value) ? value.filter((entry) => typeof entry === 'string') : [];
    return { po: list(saved.po), total: list(saved.total) };
  } catch {
    return { po: [], total: [] };
  }
}

export function saveLearned(learned) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(learned));
  } catch {
    // Learned for this visit only.
  }
}
