/**
 * Cleaning up a small picture before text recognition reads it.
 *
 * Text recognition reads black print on white paper best. A scan is rarely
 * that: grey print, cream or coloured paper, a red stamp across the number. So
 * before the box around a number is read, its picture is turned to shades of
 * grey and then to pure black and white, at the level that best separates ink
 * from paper in that picture - Otsu's method, which tries every level and keeps
 * the one where the two groups of pixels are most distinct.
 *
 * Plain arithmetic on arrays of pixels, so it can be tested without a browser.
 */

/**
 * Shades of grey from red-green-blue-alpha pixels.
 *
 * Weighed as the eye weighs them by default. Or, with `brightest`, taking each
 * pixel's brightest channel: a coloured mark - a red PAID stamp, a blue
 * signature - is bright in at least one channel and washes out to paper, while
 * black or dark print is dark in all three and stays.
 *
 * @param {Uint8ClampedArray|Uint8Array} rgba - four bytes a pixel.
 * @param {{ brightest?: boolean }} [options]
 * @returns {Uint8Array} one byte a pixel, 0 black to 255 white.
 */
export function toGray(rgba, { brightest = false } = {}) {
  const gray = new Uint8Array(rgba.length / 4);
  for (let at = 0, pixel = 0; at < rgba.length; at += 4, pixel += 1) {
    gray[pixel] = brightest
      ? Math.max(rgba[at], rgba[at + 1], rgba[at + 2])
      : Math.round(0.299 * rgba[at] + 0.587 * rgba[at + 1] + 0.114 * rgba[at + 2]);
  }
  return gray;
}

/**
 * The grey level that best splits a picture into ink and paper (Otsu's method).
 *
 * @param {Uint8Array} gray
 * @returns {number} pixels darker than this are ink.
 */
export function otsuLevel(gray) {
  const histogram = new Float64Array(256);
  for (const value of gray) histogram[value] += 1;
  const total = gray.length;
  let sumAll = 0;
  for (let level = 0; level < 256; level += 1) sumAll += level * histogram[level];

  let below = 0;
  let sumBelow = 0;
  let best = 0;
  let bestLevel = 127;
  for (let level = 0; level < 256; level += 1) {
    below += histogram[level];
    if (below === 0) continue;
    const above = total - below;
    if (above === 0) break;
    sumBelow += level * histogram[level];
    const meanBelow = sumBelow / below;
    const meanAbove = (sumAll - sumBelow) / above;
    const between = below * above * (meanBelow - meanAbove) ** 2;
    if (between > best) {
      best = between;
      bestLevel = level;
    }
  }
  return bestLevel + 1;
}

/**
 * Turn a picture to pure black and white, in place.
 *
 * @param {Uint8ClampedArray} rgba - four bytes a pixel; changed in place.
 * @param {object} [options]
 * @param {boolean} [options.threshold] - false to stop at shades of grey.
 * @param {boolean} [options.dropColour] - wash coloured marks out (see toGray).
 * @returns {{ level: number|null }} the level used, if one was.
 */
export function cleanUp(rgba, { threshold = true, dropColour = false } = {}) {
  const gray = toGray(rgba, { brightest: dropColour });
  const level = threshold ? otsuLevel(gray) : null;
  for (let at = 0, pixel = 0; at < rgba.length; at += 4, pixel += 1) {
    const value = level === null ? gray[pixel] : gray[pixel] < level ? 0 : 255;
    rgba[at] = value;
    rgba[at + 1] = value;
    rgba[at + 2] = value;
    rgba[at + 3] = 255;
  }
  return { level };
}

/**
 * The part of a page to draw for reading a box, and how large to draw it.
 *
 * The box is padded by a fifth of its size each way, so a number that sits a
 * little differently on this invoice is still inside. It is drawn so that
 * capital letters come out about `capitals` pixels tall - text recognition
 * reads best when letters are around thirty pixels high - taking the box's own
 * height as about one line of print.
 *
 * @param {{ x0: number, x1: number, y0: number, y1: number }} zone - fractions
 *   of the page, y measured up from the bottom.
 * @param {{ width: number, height: number }} page - the page's size in points.
 * @param {number} [capitals] - wanted height of a capital letter, in pixels.
 * @returns {{ x: number, y: number, width: number, height: number, scale: number }}
 *   in points from the page's top-left corner, and pixels per point.
 */
export function cropForBox(zone, page, capitals = 30) {
  const width = (zone.x1 - zone.x0) * page.width;
  const height = (zone.y1 - zone.y0) * page.height;
  const padX = Math.max(width * 0.2, 4);
  const padY = Math.max(height * 0.2, 3);
  const x = Math.max(0, zone.x0 * page.width - padX);
  const y = Math.max(0, page.height - zone.y1 * page.height - padY);
  const cropWidth = Math.min(page.width - x, width + padX * 2);
  const cropHeight = Math.min(page.height - y, height + padY * 2);
  // A capital is about seven tenths of the line; the box is about one line.
  const scale = Math.min(12, Math.max(1, capitals / (0.7 * Math.max(height, 4))));
  return { x, y, width: cropWidth, height: cropHeight, scale };
}
