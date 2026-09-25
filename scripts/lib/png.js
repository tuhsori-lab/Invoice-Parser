/**
 * A very small PNG writer, used only to build synthetic "scanned page" images
 * for the test fixtures. Node's zlib does the compression; everything else here
 * is the handful of bytes PNG needs around it.
 */

import { deflateSync, inflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Table-free CRC-32, the flavour PNG uses for every chunk. */
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** One PNG chunk: length, type, data, checksum. */
function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, checksum]);
}

/**
 * Read an 8-bit PNG back into pixels.
 *
 * Only what is needed here: eight bits a channel, colour or colour with alpha,
 * no interlacing. That is what ffmpeg writes when it is asked for frames, and
 * writing the fifteen lines that undo PNG's row filters is less trouble than
 * carrying an image library for one script.
 *
 * @param {Buffer} file
 * @returns {{ width: number, height: number, rgba: Uint8Array }}
 */
export function decodePng(file) {
  if (!file.subarray(0, 8).equals(SIGNATURE)) throw new Error('Not a PNG.');

  let width = 0;
  let height = 0;
  let channels = 3;
  const data = [];

  for (let at = 8; at < file.length;) {
    const length = file.readUInt32BE(at);
    const type = file.toString('latin1', at + 4, at + 8);
    const body = file.subarray(at + 8, at + 8 + length);

    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      if (body[8] !== 8) throw new Error('Only eight bits a channel are handled.');
      if (body[9] === 2) channels = 3;
      else if (body[9] === 6) channels = 4;
      else throw new Error(`Colour type ${body[9]} is not handled.`);
      if (body[12] !== 0) throw new Error('Interlaced PNGs are not handled.');
    } else if (type === 'IDAT') {
      data.push(body);
    } else if (type === 'IEND') {
      break;
    }
    at += 12 + length;
  }

  const raw = inflateSync(Buffer.concat(data));
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);

  // Undo the filter each row was written with. Every one of them is expressed
  // in terms of the byte to the left (a), the byte above (b), and the byte
  // above-left (c).
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const from = y * (stride + 1) + 1;
    const to = y * stride;
    const above = (y - 1) * stride;

    for (let x = 0; x < stride; x += 1) {
      const value = raw[from + x];
      const a = x >= channels ? pixels[to + x - channels] : 0;
      const b = y > 0 ? pixels[above + x] : 0;
      const c = y > 0 && x >= channels ? pixels[above + x - channels] : 0;

      let restored;
      if (filter === 0) restored = value;
      else if (filter === 1) restored = value + a;
      else if (filter === 2) restored = value + b;
      else if (filter === 3) restored = value + ((a + b) >> 1);
      else if (filter === 4) restored = value + paeth(a, b, c);
      else throw new Error(`Unknown row filter ${filter}.`);
      pixels[to + x] = restored & 0xff;
    }
  }

  // Hand back RGBA whatever came in, because that is what an encoder wants.
  const rgba = new Uint8Array(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    rgba[pixel * 4] = pixels[pixel * channels];
    rgba[pixel * 4 + 1] = pixels[pixel * channels + 1];
    rgba[pixel * 4 + 2] = pixels[pixel * channels + 2];
    rgba[pixel * 4 + 3] = channels === 4 ? pixels[pixel * channels + 3] : 255;
  }
  return { width, height, rgba };
}

/** PNG's Paeth predictor: whichever neighbour the gradient points at. */
function paeth(a, b, c) {
  const estimate = a + b - c;
  const da = Math.abs(estimate - a);
  const db = Math.abs(estimate - b);
  const dc = Math.abs(estimate - c);
  if (da <= db && da <= dc) return a;
  return db <= dc ? b : c;
}

/**
 * Encode an 8-bit greyscale image.
 *
 * @param {{ width: number, height: number, pixels: Uint8Array }} image - one
 *   byte per pixel, 0 is black and 255 is white.
 * @returns {Buffer} the PNG file.
 */
export function encodeGrayPng({ width, height, pixels }) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bits per sample
  header[9] = 0; // colour type: greyscale
  header[10] = 0; // deflate
  header[11] = 0; // adaptive filtering
  header[12] = 0; // no interlacing

  // Each row is preceded by its filter type. Filter 0 means "store as is".
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width + 1)] = 0;
    Buffer.from(pixels.buffer, pixels.byteOffset + y * width, width).copy(raw, y * (width + 1) + 1);
  }

  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
