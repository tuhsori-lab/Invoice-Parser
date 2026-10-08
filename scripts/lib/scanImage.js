/**
 * Pictures of printed paper, for the harder "scanned page" fixtures.
 *
 * The dot-matrix font in bitmapFont.js is fine for a page that only has to be
 * a picture, but text recognition reads it far worse than real print, so a
 * benchmark built on it would mostly measure the font. These pages are drawn
 * with a real typeface instead (DejaVu Sans, free to redistribute), filled from
 * its outlines with smooth edges, and then put through what scanners and paper
 * do to a page: tilt, low resolution, faint ink, coloured paper, speckle, and
 * a rubber stamp.
 *
 * Everything is in plain JavaScript and every random choice comes from a seeded
 * generator, so a fixture is the same, byte for byte, every time it is made.
 * Used only by scripts/make-fixtures.js; none of it ships with the app.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import opentype from 'opentype.js';

const require = createRequire(import.meta.url);
const FONT_DIR = join(dirname(require.resolve('dejavu-fonts-ttf/package.json')), 'ttf');

/** Read a font file into opentype.js. */
function loadFont(file) {
  const bytes = readFileSync(join(FONT_DIR, file));
  return opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));
}

/** The two weights the fixtures use. */
export const FONTS = {
  regular: loadFont('DejaVuSans.ttf'),
  bold: loadFont('DejaVuSans-Bold.ttf'),
};

/** A blank sheet: three bytes a pixel, filled with the paper's colour. */
export function createSheet(width, height, paper = [255, 255, 255]) {
  const rgb = new Uint8Array(width * height * 3);
  for (let at = 0; at < rgb.length; at += 3) {
    rgb[at] = paper[0];
    rgb[at + 1] = paper[1];
    rgb[at + 2] = paper[2];
  }
  return { width, height, rgb, paper };
}

/** A small, fast generator of repeatable "random" numbers (mulberry32). */
export function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Turn a glyph outline into closed polygons, curves cut into short straight pieces. */
function outlineToPolygons(commands, turn) {
  const polygons = [];
  let current = null;
  let last = null;
  const add = (x, y) => {
    const point = turn ? turn(x, y) : [x, y];
    current.push(point);
    last = [x, y];
  };
  for (const command of commands) {
    if (command.type === 'M') {
      current = [];
      polygons.push(current);
      add(command.x, command.y);
    } else if (command.type === 'L') {
      add(command.x, command.y);
    } else if (command.type === 'Q') {
      const [x0, y0] = last;
      for (let step = 1; step <= 8; step += 1) {
        const t = step / 8;
        const u = 1 - t;
        add(
          u * u * x0 + 2 * u * t * command.x1 + t * t * command.x,
          u * u * y0 + 2 * u * t * command.y1 + t * t * command.y
        );
      }
    } else if (command.type === 'C') {
      const [x0, y0] = last;
      for (let step = 1; step <= 12; step += 1) {
        const t = step / 12;
        const u = 1 - t;
        add(
          u * u * u * x0 +
            3 * u * u * t * command.x1 +
            3 * u * t * t * command.x2 +
            t * t * t * command.x,
          u * u * u * y0 +
            3 * u * u * t * command.y1 +
            3 * u * t * t * command.y2 +
            t * t * t * command.y
        );
      }
    }
  }
  return polygons.filter((polygon) => polygon.length > 2);
}

/** Sub-rows per pixel row: how finely an edge is followed down the page. */
const SUBROWS = 4;

/**
 * Fill polygons onto the sheet with smooth edges (non-zero winding), blending
 * `colour` over what is there, at `strength` from 0 to 1.
 */
function fillPolygons(sheet, polygons, colour, strength = 1) {
  const edges = [];
  let top = Infinity;
  let bottom = -Infinity;
  let left = Infinity;
  let right = -Infinity;
  for (const polygon of polygons) {
    for (let at = 0; at < polygon.length; at += 1) {
      const [x0, y0] = polygon[at];
      const [x1, y1] = polygon[(at + 1) % polygon.length];
      top = Math.min(top, y0);
      bottom = Math.max(bottom, y0);
      left = Math.min(left, x0);
      right = Math.max(right, x0);
      if (y0 === y1) continue;
      edges.push(
        y0 < y1 ? { x0, y0, x1, y1, dir: 1 } : { x0: x1, y0: y1, x1: x0, y1: y0, dir: -1 }
      );
    }
  }
  if (edges.length === 0) return;
  const rowFrom = Math.max(0, Math.floor(top));
  const rowTo = Math.min(sheet.height - 1, Math.ceil(bottom));
  const colFrom = Math.max(0, Math.floor(left));
  const colTo = Math.min(sheet.width - 1, Math.ceil(right));
  const span = colTo - colFrom + 1;
  if (span <= 0) return;
  const coverage = new Float32Array(span);

  for (let row = rowFrom; row <= rowTo; row += 1) {
    coverage.fill(0);
    let any = false;
    for (let sub = 0; sub < SUBROWS; sub += 1) {
      const y = row + (sub + 0.5) / SUBROWS;
      const crossings = [];
      for (const edge of edges) {
        if (y < edge.y0 || y >= edge.y1) continue;
        const x = edge.x0 + ((y - edge.y0) * (edge.x1 - edge.x0)) / (edge.y1 - edge.y0);
        crossings.push([x, edge.dir]);
      }
      if (crossings.length < 2) continue;
      crossings.sort((a, b) => a[0] - b[0]);
      let winding = 0;
      for (let at = 0; at < crossings.length - 1; at += 1) {
        winding += crossings[at][1];
        if (winding === 0) continue;
        const from = Math.max(crossings[at][0], colFrom);
        const to = Math.min(crossings[at + 1][0], colTo + 1);
        if (to <= from) continue;
        any = true;
        for (let px = Math.floor(from); px < Math.ceil(to); px += 1) {
          const overlap = Math.min(to, px + 1) - Math.max(from, px);
          if (overlap > 0) coverage[px - colFrom] += overlap / SUBROWS;
        }
      }
    }
    if (!any) continue;
    for (let at = 0; at < span; at += 1) {
      const share = Math.min(1, coverage[at]) * strength;
      if (share <= 0) continue;
      const offset = (row * sheet.width + colFrom + at) * 3;
      for (let channel = 0; channel < 3; channel += 1) {
        const under = sheet.rgb[offset + channel];
        sheet.rgb[offset + channel] = Math.round(under + (colour[channel] - under) * share);
      }
    }
  }
}

/**
 * Write a line of text.
 *
 * @param {object} sheet
 * @param {string} text
 * @param {object} options
 * @param {number} options.x - left edge, in pixels.
 * @param {number} options.y - baseline, in pixels from the top.
 * @param {number} options.size - font size in pixels.
 * @param {boolean} [options.bold]
 * @param {number[]} [options.colour] - [r, g, b].
 * @param {number} [options.strength] - how solidly the ink took, 0 to 1.
 * @param {number} [options.angle] - degrees, turned about the start of the line.
 * @returns {number} how wide the line was, in pixels.
 */
export function writeText(sheet, text, options) {
  const { x, y, size, bold = false, colour = [20, 20, 24], strength = 1, angle = 0 } = options;
  const font = bold ? FONTS.bold : FONTS.regular;
  const path = font.getPath(String(text), x, y, size);
  const radians = (angle * Math.PI) / 180;
  const turn = angle
    ? (px, py) => [
        x + (px - x) * Math.cos(radians) - (py - y) * Math.sin(radians),
        y + (px - x) * Math.sin(radians) + (py - y) * Math.cos(radians),
      ]
    : null;
  fillPolygons(sheet, outlineToPolygons(path.commands, turn), colour, strength);
  return font.getAdvanceWidth(String(text), size);
}

/** How wide a line of text will be, in pixels. */
export function textWidth(text, size, bold = false) {
  return (bold ? FONTS.bold : FONTS.regular).getAdvanceWidth(String(text), size);
}

/** Draw a rectangle's outline, `weight` pixels thick, optionally turned about its centre. */
export function drawFrame(
  sheet,
  { x, y, width, height, weight = 4, colour, strength = 1, angle = 0 }
) {
  const radians = (angle * Math.PI) / 180;
  const cx = x + width / 2;
  const cy = y + height / 2;
  const turn = (px, py) => [
    cx + (px - cx) * Math.cos(radians) - (py - cy) * Math.sin(radians),
    cy + (px - cx) * Math.sin(radians) + (py - cy) * Math.cos(radians),
  ];
  const outer = [
    [x, y],
    [x + width, y],
    [x + width, y + height],
    [x, y + height],
  ].map(([px, py]) => turn(px, py));
  // The inner edge runs the other way round, so the middle stays unfilled.
  const inner = [
    [x + weight, y + weight],
    [x + weight, y + height - weight],
    [x + width - weight, y + height - weight],
    [x + width - weight, y + weight],
  ].map(([px, py]) => turn(px, py));
  fillPolygons(sheet, [outer, inner], colour, strength);
}

/** Draw a straight rule. */
export function drawRule(sheet, { x, y, width, weight = 2, colour = [40, 40, 44] }) {
  fillPolygons(
    sheet,
    [
      [
        [x, y],
        [x + width, y],
        [x + width, y + weight],
        [x, y + weight],
      ],
    ],
    colour
  );
}

/**
 * Turn the whole sheet by a few degrees about its centre, as a sheet fed into a
 * scanner a little crooked is. Corners that come in from outside are paper.
 */
export function tilt(sheet, degrees) {
  const { width, height, rgb, paper } = sheet;
  const out = new Uint8Array(rgb.length);
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const cx = width / 2;
  const cy = height / 2;
  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      // Where this pixel came from, before the turn.
      const dx = col - cx;
      const dy = row - cy;
      const sx = cx + dx * cos + dy * sin;
      const sy = cy - dx * sin + dy * cos;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const fx = sx - x0;
      const fy = sy - y0;
      const target = (row * width + col) * 3;
      for (let channel = 0; channel < 3; channel += 1) {
        const sample = (px, py) =>
          px < 0 || py < 0 || px >= width || py >= height
            ? paper[channel]
            : rgb[(py * width + px) * 3 + channel];
        const top = sample(x0, y0) * (1 - fx) + sample(x0 + 1, y0) * fx;
        const bottom = sample(x0, y0 + 1) * (1 - fx) + sample(x0 + 1, y0 + 1) * fx;
        out[target + channel] = Math.round(top * (1 - fy) + bottom * fy);
      }
    }
  }
  sheet.rgb = out;
  return sheet;
}

/**
 * Scatter dust and dropouts across the sheet: dark specks of one to three
 * pixels, and the odd pale fleck where the toner did not take.
 */
export function speckle(sheet, { specks = 6000, seed = 1 } = {}) {
  const random = seeded(seed);
  const { width, height, rgb } = sheet;
  for (let count = 0; count < specks; count += 1) {
    const size = 1 + Math.floor(random() * 3);
    const col = Math.floor(random() * (width - size));
    const row = Math.floor(random() * (height - size));
    const dark = random() < 0.8;
    const shade = dark ? 30 + Math.floor(random() * 80) : 235 + Math.floor(random() * 20);
    for (let dy = 0; dy < size; dy += 1) {
      for (let dx = 0; dx < size; dx += 1) {
        const at = ((row + dy) * width + col + dx) * 3;
        rgb[at] = shade;
        rgb[at + 1] = shade;
        rgb[at + 2] = shade;
      }
    }
  }
  return sheet;
}

/** A light blur, as every scanner's optics give: a 3x3 average. */
export function blur(sheet) {
  const { width, height, rgb } = sheet;
  const out = new Uint8Array(rgb.length);
  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      for (let channel = 0; channel < 3; channel += 1) {
        let total = 0;
        let seen = 0;
        for (let dy = -1; dy <= 1; dy += 1) {
          const y = row + dy;
          if (y < 0 || y >= height) continue;
          for (let dx = -1; dx <= 1; dx += 1) {
            const x = col + dx;
            if (x < 0 || x >= width) continue;
            total += rgb[(y * width + x) * 3 + channel];
            seen += 1;
          }
        }
        out[(row * width + col) * 3 + channel] = Math.round(total / seen);
      }
    }
  }
  sheet.rgb = out;
  return sheet;
}
