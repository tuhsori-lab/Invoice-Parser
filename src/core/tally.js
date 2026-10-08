/**
 * How each client's invoices have gone, counted as they are exported.
 *
 * Every invoice saved - downloaded on its own, in the ZIP, or into a folder -
 * counts once a batch, under the client whose box read it:
 *
 * - accepted: went out with nothing flagged and nothing changed;
 * - corrected: its number was typed in or put right by a person;
 * - sent to review: went out with something still flagged.
 *
 * Only counts are kept - never a number, a page or a file name - so a client
 * whose numbers keep needing a look stands out over time. Invoices found by a
 * label rather than a box have no client to count them under, and are counted
 * together.
 */

/** The heading used for invoices that belong to no saved box. */
export const OTHER_CLIENT = 'Invoices found without a box';

/**
 * What became of one invoice.
 *
 * @param {object} group - a checked invoice, as verifyGroups returns it.
 * @returns {'accepted'|'corrected'|'review'}
 */
export function outcomeOf(group) {
  if (group.provenance?.source === 'manual' || group.correctedFrom) return 'corrected';
  if ((group.flags ?? []).length > 0) return 'review';
  return 'accepted';
}

/**
 * Add exported invoices to the tally.
 *
 * @param {Record<string, { name: string, accepted: number, corrected: number, review: number }>} tally
 * @param {Array<object>} groups - the invoices just exported.
 * @param {(key: string) => string|undefined} nameOf - a client's name, by its key.
 * @returns {Record<string, { name: string, accepted: number, corrected: number, review: number }>}
 *   a new tally; the one given is left as it was.
 */
export function addToTally(tally = {}, groups = [], nameOf = () => undefined) {
  const next = { ...tally };
  for (const group of groups) {
    const boxed = group.clientKey && !String(group.clientKey).startsWith('file:');
    const key = boxed ? group.clientKey : 'other';
    const before = next[key] ?? { name: '', accepted: 0, corrected: 0, review: 0 };
    const counts = { ...before, name: (boxed ? nameOf(key) : null) ?? before.name ?? '' };
    if (!boxed) counts.name = OTHER_CLIENT;
    counts[outcomeOf(group)] += 1;
    next[key] = counts;
  }
  return next;
}

/**
 * The tally as rows to show, busiest client first, the unboxed ones last.
 *
 * @param {Record<string, { name: string, accepted: number, corrected: number, review: number }>} tally
 * @returns {Array<{ key: string, name: string, accepted: number, corrected: number, review: number, total: number }>}
 */
export function tallyRows(tally = {}) {
  return Object.entries(tally)
    .map(([key, counts]) => ({
      key,
      name: counts.name || 'A client no longer remembered',
      accepted: counts.accepted ?? 0,
      corrected: counts.corrected ?? 0,
      review: counts.review ?? 0,
      total: (counts.accepted ?? 0) + (counts.corrected ?? 0) + (counts.review ?? 0),
    }))
    .sort((a, b) => (a.key === 'other') - (b.key === 'other') || b.total - a.total);
}
