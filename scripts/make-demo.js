#!/usr/bin/env node
/**
 * Record the walkthrough GIF in the README.
 *
 * It drives the real app in a real browser, using the synthetic sample PDFs, so
 * the picture in the README is the app actually working rather than a mock-up.
 * Nothing in it has ever been a real invoice.
 *
 * Needs the app to be built and served first:
 *
 *   npm run build && npm run preview -- --port 4173 &
 *   npm run demo
 */

import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
// gifenc ships as CommonJS, so its exports come off the default import.
import gifenc from 'gifenc';
import { decodePng } from './lib/png.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const FIXTURES = join(ROOT, 'tests', 'fixtures', 'pdf');
const OUT_DIR = join(ROOT, 'docs');
const WORK = join(ROOT, 'node_modules', '.demo');

const APP = process.env.DEMO_URL ?? 'http://127.0.0.1:4173';
const SIZE = { width: 1180, height: 760 };

/**
 * How many frames a second the GIF runs at, and how wide it is. Both are kept
 * modest: this is a README, and nobody should wait on a ten megabyte picture.
 */
const FPS = 8;
const GIF_WIDTH = 760;

/** Colours in the GIF. Fewer is smaller; a calm interface needs few. */
const COLOURS = 64;

/** Frames at the start that are just a blank page, before the app appears. */
const BLANK_FRAMES = 5;

/** A pause long enough for a person watching to follow what happened. */
const beat = (page, ms = 700) => page.waitForTimeout(ms);

/**
 * Find ffmpeg: the one on this machine, or the one Playwright ships for
 * recording video.
 */
function findFfmpeg() {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return 'ffmpeg';
  } catch {
    // Not on the path; look for Playwright's.
  }
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    join(process.env.HOME ?? '', '.cache', 'ms-playwright'),
  ].filter(Boolean);
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root)) {
      const candidate = join(root, entry, 'ffmpeg-linux');
      if (entry.startsWith('ffmpeg') && existsSync(candidate)) return candidate;
    }
  }
  throw new Error('No ffmpeg found. Install ffmpeg, or run `npx playwright install ffmpeg`.');
}

/**
 * Drag the mouse from one corner of a box to the other slowly enough to be seen:
 * the recording takes a handful of frames a second, and a drag done at machine
 * speed would land in one of them.
 */
async function drawBoxAround(page, text) {
  const words = page.locator('.textLayer span', { hasText: text }).first();
  await words.waitFor();
  const at = await words.boundingBox();
  const from = { x: at.x - 10, y: at.y - 7 };
  const to = { x: at.x + at.width + 10, y: at.y + at.height + 7 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  const steps = 12;
  for (let step = 1; step <= steps; step += 1) {
    await page.mouse.move(
      from.x + ((to.x - from.x) * step) / steps,
      from.y + ((to.y - from.y) * step) / steps
    );
    await page.waitForTimeout(70);
  }
  await page.mouse.up();
}

/**
 * Walk through the app, in the order somebody actually would.
 *
 * The story is the one that matters: a batch from a client whose invoice number
 * sits under a heading nothing recognises, so all four pages run together as
 * one. The app asks to be shown the number, a box is drawn around it once, and
 * the batch splits into its two invoices - continuation pages and all - which
 * are then saved straight into a folder.
 */
async function walkthrough(page) {
  await page.goto(APP);
  await beat(page, 800);

  await page.getByTestId('file-input').setInputFiles([join(FIXTURES, '22-boxed-number.pdf')]);
  await page.getByTestId('page-strip').waitFor();
  await beat(page, 1500);

  // Four pages, one invoice, no number - and the app asks to be shown it.
  await page.getByTestId('tile-1').hover();
  await beat(page, 900);
  await page.getByTestId('tile-3').hover();
  await beat(page, 900);
  await page.getByTestId('point-prompt-go').hover();
  await beat(page, 700);
  await page.getByTestId('point-prompt-go').click();
  await beat(page, 1300);

  // A box around the number, like taking a screenshot.
  await drawBoxAround(page, '50621');
  await beat(page, 1500);
  await page.getByTestId('spot-save').click();
  await beat(page, 2000);
  await page.getByRole('button', { name: 'Done' }).click();
  await beat(page, 1600);

  // Two invoices now. Save them straight into a folder, one PDF each.
  await page.getByTestId('save-folder').hover();
  await beat(page, 700);
  await page.getByTestId('save-folder').click();
  await page.getByTestId('saved-to').waitFor();
  await beat(page, 2200);
}

await rm(WORK, { recursive: true, force: true });
await mkdir(WORK, { recursive: true });
await mkdir(OUT_DIR, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: SIZE,
  recordVideo: { dir: WORK, size: SIZE },
  colorScheme: 'light',
});

// The folder picker is a window of the operating system's, which a recording
// cannot click through, so it is answered with a folder in the browser's own
// private storage. The app writes into it exactly as it would onto a disk.
await context.addInitScript(() => {
  window.showDirectoryPicker = async () => {
    const root = await navigator.storage.getDirectory();
    return root.getDirectoryHandle('Harbor & Pine, March', { create: true });
  };
});
const page = await context.newPage();

await walkthrough(page);
await context.close();
await browser.close();

const [recording] = (await readdir(WORK)).filter((name) => name.endsWith('.webm'));
if (!recording) throw new Error('The browser recorded nothing.');

/*
 * The video comes out as WebM, and the README wants a GIF. Playwright's own
 * ffmpeg is built with almost everything switched off - it can write PNG frames
 * and nothing else - so ffmpeg cuts the video into frames and the GIF is put
 * together here.
 */
execFileSync(
  findFfmpeg(),
  [
    '-y',
    '-i',
    join(WORK, recording),
    // This ffmpeg has its format detection and most of its filters switched
    // off, so the format is named outright, the frame rate is set on the
    // output rather than with the fps filter, and scale is the one filter
    // that is built in.
    '-vf',
    `scale=${GIF_WIDTH}:-1:flags=lanczos`,
    '-r',
    String(FPS),
    '-pix_fmt',
    'rgb24',
    '-f',
    'image2',
    join(WORK, 'frame-%04d.png'),
  ],
  { stdio: ['ignore', 'ignore', 'inherit'] }
);

const allFrames = (await readdir(WORK)).filter((name) => name.endsWith('.png')).sort();
if (allFrames.length === 0) throw new Error('ffmpeg produced no frames.');

// The first moments are a blank page waiting for the app to start, which is
// nobody's idea of a demonstration.
const frames = allFrames.slice(BLANK_FRAMES);

// A still from the middle, for anywhere a moving picture will not do.
await copyFile(
  join(WORK, frames[Math.floor(frames.length * 0.55)]),
  join(OUT_DIR, 'demo-still.png')
);

// One palette for the whole run, taken from a handful of frames spread across
// it. A shared palette keeps the colours steady instead of shimmering.
const samples = [0, Math.floor(frames.length / 3), Math.floor((frames.length * 2) / 3)];
const sampled = [];
let size = null;
for (const position of samples) {
  const { width, height, rgba } = decodePng(await readFile(join(WORK, frames[position])));
  size ??= { width, height };
  sampled.push(rgba);
}
const together = new Uint8Array(sampled.reduce((total, one) => total + one.length, 0));
sampled.reduce((at, one) => (together.set(one, at), at + one.length), 0);
const palette = gifenc.quantize(together, COLOURS, { format: 'rgb565' });

const encoder = gifenc.GIFEncoder();
for (const name of frames) {
  const { width, height, rgba } = decodePng(await readFile(join(WORK, name)));
  encoder.writeFrame(gifenc.applyPalette(rgba, palette, 'rgb565'), width, height, {
    palette,
    delay: Math.round(1000 / FPS),
  });
}
encoder.finish();

const gif = join(OUT_DIR, 'demo.gif');
await writeFile(gif, Buffer.from(encoder.bytes()));

await rm(WORK, { recursive: true, force: true });
const megabytes = (Buffer.from(encoder.bytes()).length / 1024 / 1024).toFixed(1);
console.log(
  `Wrote ${gif}: ${frames.length} frames, ${size.width}x${size.height}, ${megabytes} MB.`
);
console.log('Every invoice in it is made up.');
