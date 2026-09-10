/**
 * Building a password-protected PDF by hand.
 *
 * pdf-lib can read encrypted files but not write them, and the app needs one to
 * prove it shows a helpful message instead of a stack trace. So this writes the
 * smallest possible PDF that uses the standard security handler (RC4, 40-bit,
 * revision 2 - the oldest and simplest scheme, which is all a test needs).
 *
 * The result is a real PDF: it opens in any reader once the password is typed.
 */

import { createHash } from 'node:crypto';

/** The padding string every password is topped up with, from the PDF spec. */
const PASSWORD_PADDING = Buffer.from([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
  0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);

/** A fixed file id, so running the fixture script twice gives the same bytes. */
const FILE_ID = Buffer.from('4a7f1e0c93b25d6188fe3042ac95b7d1', 'hex');

/** Everything allowed; the point of the fixture is the password, not the permissions. */
const PERMISSIONS = -1;

const KEY_LENGTH = 5; // 40 bits

function md5(...parts) {
  const hash = createHash('md5');
  for (const part of parts) hash.update(part);
  return hash.digest();
}

/** RC4, written out because modern OpenSSL builds no longer offer it. */
function rc4(key, data) {
  const state = new Uint8Array(256);
  for (let i = 0; i < 256; i += 1) state[i] = i;
  let j = 0;
  for (let i = 0; i < 256; i += 1) {
    j = (j + state[i] + key[i % key.length]) & 0xff;
    [state[i], state[j]] = [state[j], state[i]];
  }
  const out = Buffer.alloc(data.length);
  let a = 0;
  let b = 0;
  for (let i = 0; i < data.length; i += 1) {
    a = (a + 1) & 0xff;
    b = (b + state[a]) & 0xff;
    [state[a], state[b]] = [state[b], state[a]];
    out[i] = data[i] ^ state[(state[a] + state[b]) & 0xff];
  }
  return out;
}

/** A password, padded out to the 32 bytes the algorithms expect. */
function padPassword(password) {
  return Buffer.concat([Buffer.from(password, 'latin1'), PASSWORD_PADDING]).subarray(0, 32);
}

/** The key used for one object: the file key, salted with the object's number. */
function objectKey(fileKey, objectNumber) {
  const salt = Buffer.from([
    objectNumber & 0xff,
    (objectNumber >> 8) & 0xff,
    (objectNumber >> 16) & 0xff,
    0,
    0,
  ]);
  return md5(fileKey, salt).subarray(0, Math.min(KEY_LENGTH + 5, 16));
}

/** Text drawing commands for one page. */
function contentStream(lines) {
  const body = lines
    .map(
      ({ text, x, y, size = 12 }) =>
        `BT /F1 ${size} Tf 1 0 0 1 ${x} ${y} Tm (${escapeText(text)}) Tj ET`
    )
    .join('\n');
  return Buffer.from(`${body}\n`, 'latin1');
}

function escapeText(text) {
  return String(text).replace(/([\\()])/g, '\\$1');
}

/**
 * Build a one-page PDF that asks for a password before it can be read.
 *
 * @param {object} [options]
 * @param {string} [options.userPassword] - the password needed to open the file.
 * @param {string} [options.ownerPassword]
 * @param {Array<{ text: string, x: number, y: number, size?: number }>} [options.lines]
 * @returns {Buffer} the PDF file.
 */
export function buildEncryptedPdf(options = {}) {
  const {
    userPassword = 'secret',
    ownerPassword = 'owner',
    lines = [{ text: 'Invoice #: 900100', x: 72, y: 700, size: 14 }],
  } = options;

  const paddedUser = padPassword(userPassword);
  const paddedOwner = padPassword(ownerPassword);

  // Owner entry: the user password, encrypted with a key made from the owner's.
  const ownerEntry = rc4(md5(paddedOwner).subarray(0, KEY_LENGTH), paddedUser);

  const permissionBytes = Buffer.alloc(4);
  permissionBytes.writeInt32LE(PERMISSIONS, 0);
  const fileKey = md5(paddedUser, ownerEntry, permissionBytes, FILE_ID).subarray(0, KEY_LENGTH);

  // User entry: the padding string, encrypted with the file key.
  const userEntry = rc4(fileKey, PASSWORD_PADDING);

  const stream = rc4(objectKey(fileKey, 4), contentStream(lines));

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
      '/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    { dictionary: `<< /Length ${stream.length} >>`, stream },
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    `<< /Filter /Standard /V 1 /R 2 /Length 40 /P ${PERMISSIONS} ` +
      `/O <${ownerEntry.toString('hex')}> /U <${userEntry.toString('hex')}> >>`,
  ];

  const chunks = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  let offset = chunks[0].length;
  const offsets = [];

  objects.forEach((object, position) => {
    offsets.push(offset);
    const number = position + 1;
    const parts =
      typeof object === 'string'
        ? [Buffer.from(`${number} 0 obj\n${object}\nendobj\n`, 'latin1')]
        : [
            Buffer.from(`${number} 0 obj\n${object.dictionary}\nstream\n`, 'latin1'),
            object.stream,
            Buffer.from('\nendstream\nendobj\n', 'latin1'),
          ];
    for (const part of parts) {
      chunks.push(part);
      offset += part.length;
    }
  });

  const xrefOffset = offset;
  const entries = ['0000000000 65535 f \n'].concat(
    offsets.map((value) => `${String(value).padStart(10, '0')} 00000 n \n`)
  );
  const id = FILE_ID.toString('hex');
  chunks.push(
    Buffer.from(
      `xref\n0 ${objects.length + 1}\n${entries.join('')}` +
        `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Encrypt ${objects.length} 0 R ` +
        `/ID [<${id}> <${id}>] >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
      'latin1'
    )
  );

  return Buffer.concat(chunks);
}
