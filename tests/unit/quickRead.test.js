/**
 * Reading only the top, the box and the foot of a scanned page.
 */

import { describe, expect, it } from 'vitest';
import {
  BOTTOM_STRIP,
  TOP_STRIP,
  placeStripLines,
  stripsFor,
  workerCount,
} from '../../src/core/quickRead.js';

describe('how many pages are read at once', () => {
  it('leaves one processor for the app, and uses at most four', () => {
    expect(workerCount(8)).toBe(4);
    expect(workerCount(4)).toBe(3);
    expect(workerCount(2)).toBe(1);
  });

  it('always reads at least one, even when the computer does not say', () => {
    expect(workerCount(1)).toBe(1);
    expect(workerCount(undefined)).toBe(1);
  });
});

describe('the bands of the page that are read', () => {
  const canvas = { width: 2480, height: 3508 };

  it('are the top and the foot when the box sits inside the top', () => {
    // A number about a sixth of the way down, as on most invoices.
    const zone = { x0: 0.76, x1: 0.88, y0: 0.82, y1: 0.836 };
    const strips = stripsFor(zone, canvas);
    expect(strips.map((strip) => strip.name)).toEqual(['top', 'bottom']);
    expect(strips[0]).toMatchObject({ top: 0, height: Math.round(3508 * TOP_STRIP) });
    expect(strips[1].top + strips[1].height).toBe(3508);
    expect(strips[1].height).toBe(3508 - Math.round(3508 * (1 - BOTTOM_STRIP)));
  });

  it('add a band across the page for a box in the middle', () => {
    const zone = { x0: 0.6, x1: 0.8, y0: 0.5, y1: 0.52 };
    const strips = stripsFor(zone, canvas);
    expect(strips.map((strip) => strip.name)).toEqual(['top', 'box', 'bottom']);
    const box = strips[1];
    expect(box.left).toBe(0);
    expect(box.width).toBe(2480);
    // The box itself, with room to spare above and below.
    expect(box.top).toBeLessThan(0.48 * 3508);
    expect(box.top + box.height).toBeGreaterThan(0.5 * 3508);
  });
});

describe('what was read in each band', () => {
  it('is put back where it sat on the whole page, top first', () => {
    const word = (text, y0) => ({
      text,
      bbox: { x0: 10, x1: 50, y0, y1: y0 + 20 },
      confidence: 90,
    });
    const line = (text, y0) => ({
      bbox: { x0: 10, x1: 50, y0, y1: y0 + 20 },
      words: [word(text, y0)],
    });
    const lines = placeStripLines([
      { strip: { left: 0, top: 3000 }, lines: [line('Page 1 of 2', 5)] },
      { strip: { left: 0, top: 0 }, lines: [line('Hollowpine Joinery', 100)] },
    ]);
    expect(lines.map((entry) => entry.words[0].text)).toEqual([
      'Hollowpine Joinery',
      'Page 1 of 2',
    ]);
    expect(lines[1].bbox).toEqual({ x0: 10, x1: 50, y0: 3005, y1: 3025 });
    expect(lines[1].words[0].bbox.y0).toBe(3005);
  });
});
