/**
 * Reading only part of a scanned page.
 *
 * Reading a whole scanned page is the slow part of the app. For a client with a
 * saved box, nearly everything that matters on a page sits in three places: the
 * top of the page, where the letterhead says whose invoice it is; the box,
 * where the number is; and the foot of the page, where "Page 2 of 3" usually
 * is. So for those clients only those three bands are read. Anything else on the
 * page - a PO number in the middle, say - is not, and the app says so.
 *
 * When the top of the page does not say which client it is, the whole page is
 * read as before. Plain arithmetic, so it can be tested without a browser.
 */

/** The top of the page read for whose invoice it is: a quarter of it. */
export const TOP_STRIP = 0.25;

/** The foot of the page read for "Page 2 of 3". */
export const BOTTOM_STRIP = 0.12;

/**
 * How many pages to read at the same time: one for each processor the computer
 * has, less one for the app itself, at most four and at least one.
 *
 * @param {number} [cores] - navigator.hardwareConcurrency.
 * @returns {number}
 */
export function workerCount(cores) {
  const known = Number(cores) || 2;
  return Math.max(1, Math.min(4, known - 1));
}

/**
 * The bands of a drawn page to read for a client with a saved box, in pixels.
 *
 * The box gets a band of its own only when it is not already inside the top or
 * the bottom one; it is padded by a fifth of its height, or a few points, so a
 * number that sits a little differently is still inside.
 *
 * @param {{ x0: number, x1: number, y0: number, y1: number }|null} zone - the
 *   box, as fractions of the page, y measured up from the bottom; null for the
 *   top and bottom only.
 * @param {{ width: number, height: number }} canvas - the drawn page, in pixels.
 * @returns {Array<{ name: string, left: number, top: number, width: number, height: number }>}
 */
export function stripsFor(zone, canvas) {
  const { width, height } = canvas;
  const topHeight = Math.round(height * TOP_STRIP);
  const bottomTop = Math.round(height * (1 - BOTTOM_STRIP));
  const strips = [
    { name: 'top', left: 0, top: 0, width, height: topHeight },
    { name: 'bottom', left: 0, top: bottomTop, width, height: height - bottomTop },
  ];
  if (!zone) return strips;

  // The box, measured down from the top of the drawn page.
  const boxTop = (1 - zone.y1) * height;
  const boxBottom = (1 - zone.y0) * height;
  const pad = Math.max((boxBottom - boxTop) * 0.2, height * 0.004);
  const above = Math.max(0, Math.floor(boxTop - pad));
  const below = Math.min(height, Math.ceil(boxBottom + pad));
  const inside = (strip) => above >= strip.top && below <= strip.top + strip.height;
  if (strips.some(inside)) return strips;

  // A band the full width of the page, so the label beside the number is read
  // with it and can back it up.
  return [strips[0], { name: 'box', left: 0, top: above, width, height: below - above }, strips[1]];
}

/**
 * Put what was read in each band back where it sat on the whole page, so the
 * box finds the number exactly as on a page read whole.
 *
 * @param {Array<{ strip: { left: number, top: number }, lines: Array<object> }>} parts
 * @returns {Array<object>} lines, top of the page first, in whole-page pixels.
 */
export function placeStripLines(parts) {
  const move = (bbox, strip) =>
    bbox && {
      x0: bbox.x0 + strip.left,
      x1: bbox.x1 + strip.left,
      y0: bbox.y0 + strip.top,
      y1: bbox.y1 + strip.top,
    };
  return parts
    .flatMap(({ strip, lines }) =>
      (lines ?? []).map((line) => ({
        ...line,
        bbox: move(line.bbox, strip),
        words: (line.words ?? []).map((word) => ({ ...word, bbox: move(word.bbox, strip) })),
      }))
    )
    .sort((a, b) => (a.bbox?.y0 ?? 0) - (b.bbox?.y0 ?? 0));
}
