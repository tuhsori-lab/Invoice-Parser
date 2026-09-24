/**
 * A 7x9 dot-matrix font, drawn into a plain pixel buffer.
 *
 * This exists so the "scanned page" fixture can be a real picture of words -
 * something text recognition can actually read - without adding a font file or
 * a canvas library to the project. Every glyph is written out as dots so it can
 * be read and corrected by eye.
 *
 * The grid is 7 wide rather than the classic 5 for one reason: at five columns
 * the diagonals of N, V and W are too coarse to tell apart, and text
 * recognition read "INVOICE" as "IHUOTICE". Seven columns give each diagonal
 * enough room to be itself.
 */

const GLYPH_WIDTH = 7;
const GLYPH_HEIGHT = 9;

/** Blank columns between one letter and the next, so they do not run together. */
const LETTER_GAP = 2;

const GLYPHS = {
  A: ['..###..', '.#...#.', '#.....#', '#.....#', '#######', '#.....#', '#.....#', '#.....#', '#.....#'], // prettier-ignore
  B: ['#####..', '#....#.', '#.....#', '#....#.', '#####..', '#....#.', '#.....#', '#....#.', '#####..'], // prettier-ignore
  C: ['..####.', '.#....#', '#......', '#......', '#......', '#......', '#......', '.#....#', '..####.'], // prettier-ignore
  D: ['#####..', '#....#.', '#.....#', '#.....#', '#.....#', '#.....#', '#.....#', '#....#.', '#####..'], // prettier-ignore
  E: ['#######', '#......', '#......', '#......', '######.', '#......', '#......', '#......', '#######'], // prettier-ignore
  F: ['#######', '#......', '#......', '#......', '######.', '#......', '#......', '#......', '#......'], // prettier-ignore
  G: ['..####.', '.#....#', '#......', '#......', '#..####', '#.....#', '#.....#', '.#....#', '..####.'], // prettier-ignore
  H: ['#.....#', '#.....#', '#.....#', '#.....#', '#######', '#.....#', '#.....#', '#.....#', '#.....#'], // prettier-ignore
  I: ['...#...', '...#...', '...#...', '...#...', '...#...', '...#...', '...#...', '...#...', '...#...'], // prettier-ignore
  J: ['#######', '.....#.', '.....#.', '.....#.', '.....#.', '.....#.', '#....#.', '#....#.', '.####..'], // prettier-ignore
  K: ['#.....#', '#....#.', '#...#..', '#..#...', '###....', '#..#...', '#...#..', '#....#.', '#.....#'], // prettier-ignore
  L: ['#......', '#......', '#......', '#......', '#......', '#......', '#......', '#......', '#######'], // prettier-ignore
  M: ['#.....#', '##...##', '#.#.#.#', '#..#..#', '#.....#', '#.....#', '#.....#', '#.....#', '#.....#'], // prettier-ignore
  N: ['##....#', '##....#', '#.#...#', '#.#...#', '#..#..#', '#...#.#', '#...#.#', '#....##', '#....##'], // prettier-ignore
  O: ['..###..', '.#...#.', '#.....#', '#.....#', '#.....#', '#.....#', '#.....#', '.#...#.', '..###..'], // prettier-ignore
  P: ['#####..', '#....#.', '#.....#', '#....#.', '#####..', '#......', '#......', '#......', '#......'], // prettier-ignore
  Q: ['..###..', '.#...#.', '#.....#', '#.....#', '#.....#', '#.....#', '#..#..#', '.#..#..', '..##..#'], // prettier-ignore
  R: ['#####..', '#....#.', '#.....#', '#....#.', '#####..', '#..#...', '#...#..', '#....#.', '#.....#'], // prettier-ignore
  S: ['..####.', '.#....#', '#......', '.#.....', '..###..', '.....#.', '......#', '#....#.', '.####..'], // prettier-ignore
  T: ['#######', '...#...', '...#...', '...#...', '...#...', '...#...', '...#...', '...#...', '...#...'], // prettier-ignore
  U: ['#.....#', '#.....#', '#.....#', '#.....#', '#.....#', '#.....#', '#.....#', '.#...#.', '..###..'], // prettier-ignore
  V: ['#.....#', '#.....#', '#.....#', '#.....#', '.#...#.', '.#...#.', '..#.#..', '..#.#..', '...#...'], // prettier-ignore
  W: ['#.....#', '#.....#', '#.....#', '#.....#', '#..#..#', '#.#.#.#', '##...##', '#.....#', '#.....#'], // prettier-ignore
  X: ['#.....#', '.#...#.', '..#.#..', '...#...', '...#...', '...#...', '..#.#..', '.#...#.', '#.....#'], // prettier-ignore
  Y: ['#.....#', '.#...#.', '..#.#..', '...#...', '...#...', '...#...', '...#...', '...#...', '...#...'], // prettier-ignore
  Z: ['#######', '.....#.', '....#..', '...#...', '..#....', '.#.....', '#......', '#......', '#######'], // prettier-ignore
  0: ['..###..', '.#...#.', '#.....#', '#....##', '#..#..#', '##....#', '#.....#', '.#...#.', '..###..'], // prettier-ignore
  1: ['...#...', '..##...', '.#.#...', '...#...', '...#...', '...#...', '...#...', '...#...', '.#####.'], // prettier-ignore
  2: ['..###..', '.#...#.', '#.....#', '......#', '.....#.', '...##..', '.##....', '#......', '#######'], // prettier-ignore
  3: ['..###..', '.#...#.', '......#', '.....#.', '..###..', '.....#.', '......#', '.#...#.', '..###..'], // prettier-ignore
  4: ['....##.', '...#.#.', '..#..#.', '.#...#.', '#....#.', '#######', '.....#.', '.....#.', '.....#.'], // prettier-ignore
  5: ['#######', '#......', '#......', '#####..', '.....#.', '......#', '......#', '#....#.', '.####..'], // prettier-ignore
  6: ['..###..', '.#...#.', '#......', '#......', '######.', '#.....#', '#.....#', '.#...#.', '..###..'], // prettier-ignore
  7: ['#######', '.....#.', '....#..', '...#...', '..#....', '..#....', '..#....', '..#....', '..#....'], // prettier-ignore
  8: ['..###..', '.#...#.', '#.....#', '.#...#.', '..###..', '.#...#.', '#.....#', '.#...#.', '..###..'], // prettier-ignore
  9: ['..###..', '.#...#.', '#.....#', '#.....#', '.######', '......#', '......#', '.#...#.', '..###..'], // prettier-ignore
  '#': ['.#...#.', '.#...#.', '#######', '.#...#.', '.#...#.', '#######', '.#...#.', '.#...#.', '.......'], // prettier-ignore
  ':': ['.......', '..##...', '..##...', '.......', '.......', '.......', '..##...', '..##...', '.......'], // prettier-ignore
  '.': ['.......', '.......', '.......', '.......', '.......', '.......', '.......', '..##...', '..##...'], // prettier-ignore
  ',': ['.......', '.......', '.......', '.......', '.......', '.......', '..##...', '..##...', '..#....'], // prettier-ignore
  '-': ['.......', '.......', '.......', '.......', '#######', '.......', '.......', '.......', '.......'], // prettier-ignore
  '/': ['......#', '.....#.', '....#..', '...#...', '..#....', '.#.....', '#......', '.......', '.......'], // prettier-ignore
  ' ': ['.......', '.......', '.......', '.......', '.......', '.......', '.......', '.......', '.......'], // prettier-ignore
};

/** A blank page to draw on: white, one byte per pixel. */
export function createCanvas(width, height) {
  const pixels = new Uint8Array(width * height).fill(255);
  return { width, height, pixels };
}

/**
 * Draw one line of text.
 *
 * @param {{ width: number, height: number, pixels: Uint8Array }} canvas
 * @param {string} text - anything not in the font is drawn as a space.
 * @param {object} options
 * @param {number} options.x - left edge, in pixels.
 * @param {number} options.y - top edge, in pixels.
 * @param {number} [options.scale] - how many pixels wide one dot is.
 * @param {number} [options.gray] - 0 is black, 255 is white.
 */
export function drawText(canvas, text, { x, y, scale = 4, gray = 20 }) {
  let cursor = x;
  for (const character of String(text).toUpperCase()) {
    const glyph = GLYPHS[character] ?? GLYPHS[' '];
    for (let row = 0; row < GLYPH_HEIGHT; row += 1) {
      for (let column = 0; column < GLYPH_WIDTH; column += 1) {
        if (glyph[row][column] !== '#') continue;
        fillBlock(canvas, cursor + column * scale, y + row * scale, scale, gray);
      }
    }
    cursor += (GLYPH_WIDTH + LETTER_GAP) * scale;
  }
  return cursor;
}

/** How wide a string will be once drawn. */
export function measureText(text, scale = 4) {
  return String(text).length * (GLYPH_WIDTH + LETTER_GAP) * scale;
}

/**
 * Soften the whole page, the way a scanner does.
 *
 * Hard square pixels are not what text recognition is trained on, and a real
 * scan never has them. A light blur makes the fixture both more honest and
 * markedly easier to read.
 *
 * @param {{ width: number, height: number, pixels: Uint8Array }} canvas
 */
export function soften(canvas) {
  const { width, height, pixels } = canvas;
  const out = new Uint8Array(pixels.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let total = 0;
      let seen = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        const row = y + dy;
        if (row < 0 || row >= height) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          const column = x + dx;
          if (column < 0 || column >= width) continue;
          total += pixels[row * width + column];
          seen += 1;
        }
      }
      out[y * width + x] = Math.round(total / seen);
    }
  }
  canvas.pixels.set(out);
  return canvas;
}

function fillBlock(canvas, x, y, size, gray) {
  for (let dy = 0; dy < size; dy += 1) {
    const row = y + dy;
    if (row < 0 || row >= canvas.height) continue;
    for (let dx = 0; dx < size; dx += 1) {
      const column = x + dx;
      if (column < 0 || column >= canvas.width) continue;
      canvas.pixels[row * canvas.width + column] = gray;
    }
  }
}
