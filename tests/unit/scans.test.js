/**
 * Telling a scan from a typed page, and reading a scan well.
 *
 * A scan can carry a few words on top of the picture and still have no invoice
 * number anywhere in its text. What gives it away is that most of the page is
 * an image. And because text recognition misreads a number now and then, and
 * says how sure it was, an unsure reading is read again and the surer kept.
 */

import { describe, expect, it } from 'vitest';
import {
  describePicture,
  isPicture,
  needsSecondLook,
  readingWidths,
  secondIsBetter,
  SURE_READING,
} from '../../src/core/scans.js';

/** A stand-in for pdf.js's table of operation codes. */
const OPS = {
  save: 10,
  restore: 11,
  transform: 12,
  paintFormXObjectBegin: 74,
  paintFormXObjectEnd: 75,
  paintImageXObject: 85,
  paintInlineImageXObject: 86,
  paintImageMaskXObject: 83,
  paintImageXObjectRepeat: 88,
  showText: 44,
};

/** Build an operator list from [code, args] pairs. */
const list = (...ops) => ({ fnArray: ops.map(([code]) => code), argsArray: ops.map(([, a]) => a) });

const A4 = { width: 595, height: 841 };

describe('how much of a page is a picture', () => {
  it('sees a scan drawn over the whole page', () => {
    const scan = list(
      [OPS.save],
      [OPS.transform, [595, 0, 0, 841, 0, 0]],
      [OPS.paintImageXObject, ['img_1', 2480, 3508]],
      [OPS.restore]
    );
    const picture = describePicture(scan, OPS, A4.width, A4.height);

    expect(picture.share).toBeCloseTo(1);
    expect(picture.pixelsAcross).toBe(2480);
    expect(isPicture(picture)).toBe(true);
  });

  it('sees a typed page with a small logo as not a picture', () => {
    const typed = list(
      [OPS.showText, []],
      [OPS.save],
      [OPS.transform, [120, 0, 0, 40, 40, 780]],
      [OPS.paintImageXObject, ['logo', 600, 200]],
      [OPS.restore],
      [OPS.showText, []]
    );
    const picture = describePicture(typed, OPS, A4.width, A4.height);

    expect(picture.share).toBeLessThan(0.02);
    expect(isPicture(picture)).toBe(false);
  });

  it('works out how finely the page was scanned, whatever size it is drawn at', () => {
    // A 150 dpi scan drawn a little inside the page edges.
    const scan = list(
      [OPS.transform, [0.95, 0, 0, 0.95, 15, 20]],
      [OPS.transform, [595, 0, 0, 841, 0, 0]],
      [OPS.paintImageXObject, ['img_1', 1178, 1666]]
    );

    expect(describePicture(scan, OPS, A4.width, A4.height).pixelsAcross).toBe(1240);
  });

  it('forgets a transform once the drawing state is restored', () => {
    const later = list(
      [OPS.save],
      [OPS.transform, [595, 0, 0, 841, 0, 0]],
      [OPS.restore],
      [OPS.paintImageXObject, ['dot', 1, 1]]
    );

    expect(describePicture(later, OPS, A4.width, A4.height).share).toBeLessThan(0.001);
  });

  it('follows a transform carried by a form, and drops it when the form ends', () => {
    const form = list(
      [OPS.paintFormXObjectBegin, [[595, 0, 0, 841, 0, 0], null]],
      [OPS.paintImageXObject, ['img_1', 2480, 3508]],
      [OPS.paintFormXObjectEnd, []],
      [OPS.paintImageXObject, ['dot', 1, 1]]
    );

    expect(describePicture(form, OPS, A4.width, A4.height).share).toBeCloseTo(1);
  });

  it('counts a small image stamped many times by how many times', () => {
    const tiles = list(
      [OPS.transform, [100, 0, 0, 100, 0, 0]],
      [OPS.paintImageXObjectRepeat, ['tile', 1, 1, [0, 0, 100, 0, 200, 0, 300, 0]]]
    );

    expect(describePicture(tiles, OPS, A4.width, A4.height).share).toBeCloseTo(
      (4 * 100 * 100) / (595 * 841)
    );
  });

  it('says nothing is a picture when there is nothing to go on', () => {
    expect(describePicture(null, OPS, 595, 841)).toEqual({ share: 0, pixelsAcross: 0 });
    expect(describePicture(list(), OPS, 0, 0)).toEqual({ share: 0, pixelsAcross: 0 });
    expect(isPicture(undefined)).toBe(false);
  });
});

describe('how large to draw a scan to read it', () => {
  it('reads a scan at the size it was made', () => {
    expect(readingWidths(2480).first).toBe(2480);
  });

  it('never goes below the size small print needs, or above about 300 dpi', () => {
    expect(readingWidths(1240).first).toBe(1500);
    expect(readingWidths(4960).first).toBe(2600);
    expect(readingWidths(0).first).toBe(1500);
    expect(readingWidths(undefined).first).toBe(1500);
  });

  it('takes a second look a quarter smaller, but not too small', () => {
    expect(readingWidths(2480).second).toBe(1860);
    expect(readingWidths(1240).second).toBe(1200);
  });
});

describe('when to read a page again', () => {
  it('reads it again when no number was found', () => {
    expect(needsSecondLook({ value: null, confidence: null })).toBe(true);
  });

  it('reads it again when the number was read unsurely', () => {
    expect(needsSecondLook({ value: '2031/VT', confidence: 38 })).toBe(true);
  });

  it('leaves it when the number was read surely', () => {
    expect(needsSecondLook({ value: '2031/VT/00412', confidence: SURE_READING })).toBe(false);
    expect(needsSecondLook({ value: '2031/VT/00412', confidence: 92 })).toBe(false);
  });

  it('leaves it when nothing says how sure the reading was', () => {
    expect(needsSecondLook({ value: '2031/VT/00412', confidence: null })).toBe(false);
  });
});

describe('which of two readings to keep', () => {
  it('keeps a reading that found a number over one that did not', () => {
    expect(secondIsBetter({ value: null }, { value: '88213', confidence: 60 })).toBe(true);
    expect(secondIsBetter({ value: '88213', confidence: 60 }, { value: null })).toBe(false);
  });

  it('keeps the surer of two that both found one', () => {
    expect(
      secondIsBetter(
        { value: '2031/VT', confidence: 38 },
        { value: '2031/VT/00412', confidence: 92 }
      )
    ).toBe(true);
    expect(
      secondIsBetter(
        { value: '2031/VT/00412', confidence: 70 },
        { value: '2031/VK/00412', confidence: 40 }
      )
    ).toBe(false);
  });

  it('keeps the first on a tie', () => {
    expect(
      secondIsBetter({ value: '88213', confidence: 80 }, { value: '88218', confidence: 80 })
    ).toBe(false);
  });
});
