/**
 * Telling one invoice from the next.
 *
 * The page strip is the one place this app uses colour to carry meaning, so the
 * colours are a short, muted sequence rather than a rainbow: enough to see
 * where one invoice ends and the next begins, calm enough to look at all day.
 * The actual values live in styles.css so the dark theme can shift them.
 */

/** How many colours the sequence has before it starts again. */
export const TILE_COLOURS = 8;

/**
 * The colour class for the nth invoice in the batch.
 *
 * @param {number} index - 0-based position of the invoice.
 * @returns {string}
 */
export function tileClass(index) {
  return `tile-c${(index % TILE_COLOURS) + 1}`;
}
