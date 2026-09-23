#!/usr/bin/env node
/**
 * Copy the pdf.js font metrics into public/, so the app serves them itself.
 *
 * pdf.js normally fetches these from a CDN. This app must never make a request
 * while someone is working on confidential invoices, so they are copied in at
 * build time and served from the app's own origin.
 *
 * Runs automatically before `npm run dev` and `npm run build`.
 */

import { cp, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PDFJS = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
const DESTINATION = join(HERE, '..', 'public', 'pdfjs', 'standard_fonts');

await mkdir(DESTINATION, { recursive: true });
await cp(join(PDFJS, 'standard_fonts'), DESTINATION, { recursive: true });

console.log('Copied the pdf.js font metrics into public/pdfjs/standard_fonts.');
