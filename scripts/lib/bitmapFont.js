/**
 * A 5x7 dot-matrix font, drawn into a plain pixel buffer.
 *
 * This exists so the "scanned page" fixture can be a real picture of words -
 * something text recognition can actually read - without adding a font file or
 * a canvas library to the project. Every glyph is written out as dots so it can
 * be read and corrected by eye.
 */

const GLYPH_WIDTH = 5;
const GLYPH_HEIGHT = 7;

const GLYPHS = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.###.'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
  J: ['#####', '....#', '....#', '....#', '....#', '#...#', '.###.'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  0: ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  1: ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  2: ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  3: ['#####', '...#.', '..#..', '...#.', '....#', '#...#', '.###.'],
  4: ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  5: ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  6: ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
  7: ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  8: ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  9: ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
  '#': ['.#.#.', '.#.#.', '#####', '.#.#.', '#####', '.#.#.', '.#.#.'],
  ':': ['.....', '..#..', '..#..', '.....', '..#..', '..#..', '.....'],
  '.': ['.....', '.....', '.....', '.....', '.....', '.##..', '.##..'],
  ',': ['.....', '.....', '.....', '.....', '.##..', '.##..', '.#...'],
  '-': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
  '/': ['....#', '....#', '...#.', '..#..', '.#...', '#....', '#....'],
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
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
    cursor += (GLYPH_WIDTH + 1) * scale;
  }
  return cursor;
}

/** How wide a string will be once drawn. */
export function measureText(text, scale = 4) {
  return String(text).length * (GLYPH_WIDTH + 1) * scale;
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
