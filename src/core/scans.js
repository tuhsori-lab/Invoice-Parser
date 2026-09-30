/**
 * Pages that are pictures of paper, and how to read them.
 *
 * A scanner leaves a page that is one big photograph of the paper. Some leave
 * nothing else, and those are easy: there is no text at all. Others add a few
 * words on top - a stamp, a note, a table somebody pasted in - and then the page
 * does have text, just not the text printed on the paper, and the invoice
 * number is nowhere in it. The way to tell such a page from an ordinary one is
 * that most of it is covered by an image.
 *
 * pdf.js describes what a page draws as a list of operations. This walks that
 * list, keeping track of where the drawing is placed, and adds up the area of
 * every image drawn. It takes the list and the operation codes as plain values,
 * so it can be tested without opening a PDF.
 *
 * It also works out how finely the paper was scanned - how many of the scan's
 * own pixels run across the page - because text recognition reads a scan best
 * near the size it was made: shrinking a 300 dpi scan to fit a smaller picture
 * blurs exactly the small print an invoice number is set in.
 *
 * Recognition is not steady, though. On a real scanned batch, the same two
 * ledger letters in the middle of an invoice number came out as a letter and a
 * percent sign on some pages at one size, and as the wrong letter on others at
 * another, and each misreading came with a low score for how sure recognition
 * was. So a page whose number was read unsurely, or
 * not at all, is read a second time at another size, and the surer reading is
 * kept. Everything here is plain arithmetic, so it can be tested on its own.
 */

/** Share of the page an image has to cover for the page to count as a scan. */
export const PICTURE_SHARE = 0.5;

/** Multiply two 2-D transforms, each written [a, b, c, d, e, f]. */
function multiply(m, n) {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

/** How many pixels wide an image is, from the arguments of the operation drawing it. */
function pixelsWide(args) {
  if (!Array.isArray(args)) return 0;
  // An image kept apart from the page comes as [name, width, height]; one
  // written into the page itself comes as the image, which knows its width.
  if (typeof args[1] === 'number') return args[1];
  return Number(args[0]?.width) || 0;
}

/**
 * How much of a page is covered by images, and how finely the largest was scanned.
 *
 * An image is drawn into a unit square, stretched by whatever transform is in
 * force, so its area on the page is the size of that transform. Overlapping
 * images are counted twice; the share is capped at 1, and only has to be good
 * enough to tell "mostly picture" from "mostly not".
 *
 * @param {{ fnArray: number[], argsArray: Array<any> }} operatorList - from pdf.js.
 * @param {object} ops - pdf.js's OPS table, the codes the list is written in.
 * @param {number} width - the page's width.
 * @param {number} height - the page's height.
 * @returns {{ share: number, pixelsAcross: number }} the share of the page, 0 to
 *   1, and how many of the largest image's pixels would run across the whole
 *   width of the page (0 when there is no image).
 */
export function describePicture(operatorList, ops, width, height) {
  const pageArea = Math.abs(width * height);
  if (!operatorList?.fnArray || !ops || !pageArea) return { share: 0, pixelsAcross: 0 };

  const images = new Set(
    [ops.paintImageXObject, ops.paintInlineImageXObject, ops.paintImageMaskXObject].filter(
      (code) => code !== undefined
    )
  );

  let transform = [1, 0, 0, 1, 0, 0];
  const saved = [];
  let area = 0;
  let largest = 0;
  let pixelsAcross = 0;

  const { fnArray, argsArray = [] } = operatorList;
  for (let position = 0; position < fnArray.length; position += 1) {
    const code = fnArray[position];
    const args = argsArray[position];
    if (code === ops.save) {
      saved.push(transform);
    } else if (code === ops.restore) {
      transform = saved.pop() ?? transform;
    } else if (code === ops.transform && Array.isArray(args) && args.length === 6) {
      transform = multiply(transform, args);
    } else if (code === ops.paintFormXObjectBegin) {
      // A form carries its own transform, undone when it ends.
      saved.push(transform);
      const matrix = Array.isArray(args) ? args[0] : null;
      if (Array.isArray(matrix) && matrix.length === 6) transform = multiply(transform, matrix);
    } else if (code === ops.paintFormXObjectEnd) {
      transform = saved.pop() ?? transform;
    } else if (code === ops.paintImageXObjectRepeat) {
      // One small image stamped many times: [name, scale x, scale y, positions].
      const [, scaleX = 0, scaleY = 0, positions = []] = Array.isArray(args) ? args : [];
      const each = Math.abs(transform[0] * transform[3] - transform[1] * transform[2]);
      area += each * Math.abs(scaleX * scaleY) * Math.floor((positions?.length ?? 0) / 2);
    } else if (images.has(code)) {
      const drawn = Math.abs(transform[0] * transform[3] - transform[1] * transform[2]);
      area += drawn;
      const across = Math.hypot(transform[0], transform[1]);
      if (drawn > largest && across > 0) {
        largest = drawn;
        pixelsAcross = Math.round((pixelsWide(args) * Math.abs(width)) / across);
      }
    }
  }

  return { share: Math.min(1, area / pageArea), pixelsAcross };
}

/**
 * Is this page a picture of paper, whatever text may sit on top of it?
 *
 * @param {{ share: number }|undefined} picture - from describePicture.
 * @returns {boolean}
 */
export function isPicture(picture) {
  return typeof picture?.share === 'number' && picture.share >= PICTURE_SHARE;
}

/** Narrowest a page is drawn for text recognition: small print needs the room. */
const NARROWEST_READING = 1500;

/** Widest: about 300 dots per inch, past which recognition only gets slower. */
const WIDEST_READING = 2600;

/** Narrowest a second look goes. */
const NARROWEST_SECOND_LOOK = 1200;

/**
 * How wide to draw a page for text recognition, and how wide for a second look.
 *
 * A scan is read at the size it was made, within limits, and looked at again a
 * quarter smaller when that is needed.
 *
 * @param {number} [pixelsAcross] - from describePicture; 0 or missing when unknown.
 * @returns {{ first: number, second: number }} widths in pixels.
 */
export function readingWidths(pixelsAcross) {
  const native = Number(pixelsAcross) || 0;
  const first = Math.round(Math.min(WIDEST_READING, Math.max(NARROWEST_READING, native)));
  const second = Math.max(NARROWEST_SECOND_LOOK, Math.round(first * 0.75));
  return { first, second };
}

/**
 * How sure, from 0 to 100, recognition has to be of an invoice number to take
 * it without a second look. On the scanned batch this was set against, every
 * misread number scored 63 or less and nearly every correct one 80 or more.
 */
export const SURE_READING = 75;

/**
 * Should a page be read again?
 *
 * @param {{ value: string|null, confidence: number|null }} verdict - what a
 *   reading gave: its invoice number, and how sure recognition was of it.
 * @returns {boolean} yes when it gave no number, or one read unsurely.
 */
export function needsSecondLook(verdict) {
  if (!verdict?.value) return true;
  return typeof verdict.confidence === 'number' && verdict.confidence < SURE_READING;
}

/**
 * Is the second reading of a page better than the first?
 *
 * One that finds a number beats one that does not; between two that both do,
 * the one recognition was surer of wins. A tie keeps the first.
 *
 * @param {{ value: string|null, confidence: number|null }} first
 * @param {{ value: string|null, confidence: number|null }} second
 * @returns {boolean}
 */
export function secondIsBetter(first, second) {
  if (!second?.value) return false;
  if (!first?.value) return true;
  return (second.confidence ?? 0) > (first.confidence ?? 0);
}
