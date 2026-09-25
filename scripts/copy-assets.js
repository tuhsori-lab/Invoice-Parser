#!/usr/bin/env node
/**
 * Copy the things pdf.js and tesseract.js would otherwise fetch from a CDN.
 *
 * This app must never make a request while someone is working on confidential
 * invoices, so everything either library asks for at runtime is copied out of
 * node_modules at build time and served from the app's own origin.
 *
 * The text recognition files are large but are only fetched when somebody
 * actually turns text recognition on, so an ordinary batch never loads them.
 *
 * Runs automatically before `npm run dev` and `npm run build`.
 */

import { cp, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, '..', 'public');

/** Where a package lives on disk. */
const packageDir = (name) => dirname(require.resolve(`${name}/package.json`));

/** The font metrics pdf.js needs for the fonts every PDF may assume exist. */
async function copyPdfjsFonts() {
  const to = join(PUBLIC, 'pdfjs', 'standard_fonts');
  await mkdir(to, { recursive: true });
  await cp(join(packageDir('pdfjs-dist'), 'standard_fonts'), to, { recursive: true });
  return 'pdfjs/standard_fonts';
}

/**
 * The text recognition engine: its worker, its WebAssembly, and the English
 * language data. "best_int" is the most accurate model small enough to serve.
 */
async function copyTesseract() {
  const to = join(PUBLIC, 'tesseract');
  await mkdir(join(to, 'lang'), { recursive: true });

  await cp(join(packageDir('tesseract.js'), 'dist', 'worker.min.js'), join(to, 'worker.min.js'));

  const core = packageDir('tesseract.js-core');
  for (const file of [
    'tesseract-core.wasm.js',
    'tesseract-core-simd.wasm.js',
    'tesseract-core-lstm.wasm.js',
    'tesseract-core-simd-lstm.wasm.js',
  ]) {
    await cp(join(core, file), join(to, file));
  }

  await cp(
    join(packageDir('@tesseract.js-data/eng'), '4.0.0_best_int', 'eng.traineddata.gz'),
    join(to, 'lang', 'eng.traineddata.gz')
  );
  return 'tesseract';
}

const written = [await copyPdfjsFonts(), await copyTesseract()];
console.log(`Copied into public/: ${written.join(', ')}.`);
console.log('Nothing in this app is fetched from a CDN.');
