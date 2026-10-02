/**
 * Whether the advanced controls are open, remembered on this computer.
 *
 * Most people never need them, so they start closed; somebody who opens them
 * finds them open next time. Only this one yes or no is kept, and a browser that
 * will not keep it simply starts closed again.
 */

const KEY = 'invoice-splitter.controls-open.v1';

/** Were the controls left open last time? */
export function loadControlsOpen() {
  try {
    return window.localStorage.getItem(KEY) === 'yes';
  } catch {
    return false;
  }
}

/** Remember whether they are open. */
export function saveControlsOpen(open) {
  try {
    if (open) window.localStorage.setItem(KEY, 'yes');
    else window.localStorage.removeItem(KEY);
  } catch {
    // Not remembered, but still open or closed for this visit.
  }
}
