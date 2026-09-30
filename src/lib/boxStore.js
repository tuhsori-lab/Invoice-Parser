/**
 * Remembering the boxes drawn around invoice numbers, between visits.
 *
 * A box belongs to the client whose page it was drawn on, recognised by their
 * letterhead, so their next batch is read without being asked again. What is
 * kept is where the number sits on the page and the shape of it - never the
 * number, nor anything else from an invoice.
 *
 * It lives in this browser's own storage and nowhere else. Storage can fail: a
 * private window, a browser set to block site data, a full disk. None of that
 * should stop anyone splitting a batch, so every call here fails quietly and
 * the app carries on with whatever it has in memory.
 */

import { createProfile } from '../core/profiles.js';

/**
 * Unchanged from when clients had profiles of their own, so that boxes drawn
 * then are still remembered now.
 */
const KEY = 'invoice-splitter.profiles.v1';

/**
 * Keep only what a remembered box needs. Anything else an older version of the
 * app kept - labels, file name patterns - is left behind here, and so is any
 * client that had no box.
 */
function asBox(entry) {
  const box = createProfile({
    id: entry?.id,
    name: entry?.name,
    identifyingText: entry?.identifyingText,
    zone: entry?.zone,
    zoneShape: entry?.zoneShape,
  });
  return box.zone ? box : null;
}

/**
 * The boxes remembered in this browser, one per client.
 *
 * @returns {Array<object>}
 */
export function loadBoxes() {
  try {
    const stored = window.localStorage.getItem(KEY);
    if (!stored) return [];
    return (JSON.parse(stored).profiles ?? []).map(asBox).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Remember these boxes for next time.
 *
 * @param {Array<object>} boxes
 * @returns {boolean} whether they could be saved.
 */
export function saveBoxes(boxes) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ profiles: boxes }));
    return true;
  } catch {
    return false;
  }
}
