/**
 * Cleaning up the picture of a box before it is read.
 */

import { describe, expect, it } from 'vitest';
import { cleanUp, cropForBox, otsuLevel, toGray } from '../../src/core/image.js';

/** RGBA pixels from a list of [r, g, b]. */
const rgba = (pixels) => new Uint8ClampedArray(pixels.flatMap(([r, g, b]) => [r, g, b, 255]));

describe('shades of grey', () => {
  it('weighs green most and blue least, as the eye does', () => {
    expect([
      ...toGray(
        rgba([
          [255, 255, 255],
          [0, 0, 0],
          [0, 255, 0],
          [0, 0, 255],
        ])
      ),
    ]).toEqual([255, 0, 150, 29]);
  });
});

describe('the level between ink and paper', () => {
  it('falls between faint grey print and cream paper', () => {
    const gray = new Uint8Array([...Array(80).fill(240), ...Array(20).fill(150)]);
    const level = otsuLevel(gray);
    expect(level).toBeGreaterThan(150);
    expect(level).toBeLessThanOrEqual(240);
  });

  it('turns faint grey print black and cream paper white', () => {
    // Mostly paper, some print - as in the picture of a box around a number.
    const pixels = rgba([...Array(30).fill([246, 236, 196]), ...Array(10).fill([150, 150, 150])]);
    cleanUp(pixels);
    const gray = [...toGray(pixels)];
    expect(gray.slice(0, 30).every((value) => value === 255)).toBe(true);
    expect(gray.slice(30).every((value) => value === 0)).toBe(true);
  });

  it('turns dark blue print black on yellowed paper', () => {
    const pixels = rgba([...Array(30).fill([246, 236, 196]), ...Array(10).fill([30, 40, 90])]);
    cleanUp(pixels);
    expect([...toGray(pixels)].slice(30).every((value) => value === 0)).toBe(true);
  });

  it('can wash a red stamp out while keeping black print', () => {
    const pixels = rgba([
      ...Array(30).fill([255, 255, 255]),
      ...Array(8).fill([196, 32, 44]), // the stamp
      ...Array(8).fill([20, 20, 24]), // the number
    ]);
    cleanUp(pixels, { dropColour: true });
    const gray = [...toGray(pixels)];
    expect(gray.slice(30, 38).every((value) => value === 255)).toBe(true);
    expect(gray.slice(38).every((value) => value === 0)).toBe(true);
  });

  it('can stop at shades of grey', () => {
    const pixels = rgba([[200, 100, 50]]);
    expect(cleanUp(pixels, { threshold: false }).level).toBeNull();
    expect([...pixels.slice(0, 3)]).toEqual([124, 124, 124]);
  });
});

describe('the part of the page to read', () => {
  const page = { width: 595, height: 842 };
  const zone = { x0: 455 / 595, x1: 520 / 595, y0: 693 / 842, y1: 707 / 842 };

  it('pads the box by a fifth each way, measured from the top of the page', () => {
    const crop = cropForBox(zone, page);
    expect(crop.x).toBeCloseTo(455 - 13, 5);
    expect(crop.width).toBeCloseTo(65 + 26, 5);
    // A fifth of 14 points is under the 3-point minimum, so 3 it is.
    expect(crop.y).toBeCloseTo(842 - 707 - 3, 5);
    expect(crop.height).toBeCloseTo(14 + 2 * 3, 5);
  });

  it('draws it large enough for capitals about thirty pixels tall', () => {
    const { scale } = cropForBox(zone, page, 30);
    expect(0.7 * 14 * scale).toBeCloseTo(30, 5);
    expect(cropForBox(zone, page, 42).scale).toBeGreaterThan(scale);
  });

  it('stays on the page', () => {
    const corner = cropForBox({ x0: 0, x1: 0.1, y0: 0.95, y1: 1 }, page);
    expect(corner.x).toBe(0);
    expect(corner.y).toBe(0);
  });
});
