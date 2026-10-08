#!/usr/bin/env node
/**
 * `npm run bench`: how often the app gets an invoice wrong, and how fast it
 * reads scans.
 *
 * Starts the development server, opens bench/index.html in a headless browser -
 * so the real pdf.js, the real text recognition and the app's own code do the
 * work - and prints, per sample PDF and overall: invoices right, invoices
 * wrong, wrong ones nothing flagged, invoices sent for review, page splits
 * right, and seconds per scanned page.
 *
 *   npm run bench                        everything
 *   npm run bench -- --only 26,31        just those samples (both modes)
 *   npm run bench -- --mode box          only runs with a saved box
 *   npm run bench -- --mode list         only runs checked against an invoice list
 *   npm run bench -- --save-baseline     keep this run as the one to compare with
 *
 * Results go to bench/results/latest.json. When bench/baseline.json exists, the
 * report ends with the change against it. Nothing the browser does is allowed
 * off this machine: a request to anywhere but the local server fails the run.
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const RESULTS = join(ROOT, 'bench', 'results');
const BASELINE = join(ROOT, 'bench', 'baseline.json');
const PORT = 4190;

/** Read `--name value` and `--flag` from the command line. */
function options(argv) {
  const out = {};
  for (let at = 0; at < argv.length; at += 1) {
    const arg = argv[at];
    if (!arg.startsWith('--')) continue;
    const name = arg.slice(2);
    const next = argv[at + 1];
    if (next && !next.startsWith('--')) {
      out[name] = next;
      at += 1;
    } else {
      out[name] = true;
    }
  }
  return out;
}

/** Add up a list of per-sample results. */
function totals(results) {
  const sum = (key) => results.reduce((total, entry) => total + (entry[key] ?? 0), 0);
  const scanned = sum('scannedPages');
  const seconds = sum('ocrSeconds');
  return {
    expected: sum('expected'),
    correct: sum('correct'),
    wrong: sum('wrong'),
    wrongUnflagged: sum('wrongUnflagged'),
    wrongOnlyScanFlag: sum('wrongOnlyScanFlag'),
    sentToReview: sum('sentToReview'),
    correctSplits: sum('correctSplits'),
    scannedPages: scanned,
    secondsPerScannedPage: scanned ? seconds / scanned : 0,
  };
}

/** The numbers to print for one row. */
function row(label, entry) {
  const perPage = entry.scannedPages
    ? ((entry.secondsPerScannedPage ?? entry.ocrSeconds / entry.scannedPages) || 0).toFixed(2)
    : '-';
  return [
    label.padEnd(16),
    String(entry.expected).padStart(4),
    String(entry.correct).padStart(7),
    String(entry.wrong).padStart(5),
    String(entry.wrongUnflagged).padStart(11),
    String(entry.wrongOnlyScanFlag).padStart(9),
    String(entry.sentToReview).padStart(6),
    String(entry.correctSplits).padStart(6),
    String(entry.scannedPages || '-').padStart(5),
    perPage.padStart(7),
  ].join(' ');
}

const HEADER = [
  'sample'.padEnd(16),
  ' exp',
  'correct',
  'wrong',
  'wrong+quiet',
  'only-scan',
  'review',
  'splits',
  'scans',
  's/page',
].join(' ');

/** Print the report, and the change against the baseline when there is one. */
function report(results, baseline) {
  console.log(`\n${HEADER}`);
  for (const entry of results) {
    if (entry.error) {
      console.log(`${`${entry.id} ${entry.mode}`.padEnd(16)} FAILED: ${entry.error}`);
      continue;
    }
    console.log(row(entry.id, entry));
  }
  const groups = {
    typed: results.filter((entry) => !entry.scannedPages && !entry.error),
    'scans, labels': results.filter((entry) => entry.scannedPages && entry.mode === 'labels'),
    'scans, box': results.filter((entry) => entry.scannedPages && entry.mode === 'box'),
    'scans, list': results.filter((entry) => entry.scannedPages && entry.mode === 'list'),
    overall: results.filter((entry) => !entry.error),
  };
  console.log('');
  const summary = {};
  for (const [name, list] of Object.entries(groups)) {
    summary[name] = totals(list);
    console.log(row(name, summary[name]));
  }
  console.log(
    '\nwrong+quiet = wrong, and nothing flagged it. only-scan = wrong, and the only flag was ' +
      '"read from a scan", which every scanned invoice carries.'
  );

  for (const entry of results) {
    for (const detail of entry.details ?? []) {
      console.log(
        `  ${entry.id}: pages ${detail.pages.join(',')} came out as ${detail.got ?? '(no number)'}` +
          `${detail.expected ? `, should be ${detail.expected}` : ', not a right split'}` +
          ` [${detail.flags.join(', ') || 'NOT FLAGGED'}]`
      );
    }
  }

  if (baseline?.summary) {
    console.log('\nAgainst the baseline:');
    for (const [name, now] of Object.entries(summary)) {
      const before = baseline.summary[name];
      if (!before) continue;
      const change = (key, digits = 0) =>
        `${before[key].toFixed(digits)} -> ${now[key].toFixed(digits)}`;
      console.log(
        `  ${name.padEnd(14)} correct ${change('correct')}, wrong+quiet ${change('wrongUnflagged')}, ` +
          `review ${change('sentToReview')}, s/page ${change('secondsPerScannedPage', 2)}`
      );
    }
  }
  return summary;
}

async function main() {
  const args = options(process.argv.slice(2));

  // The pages to read, and the engine files the app serves itself.
  if (!existsSync(join(ROOT, 'tests', 'fixtures', 'pdf', '34-scan-suffix.pdf'))) {
    execFileSync(process.execPath, [join(HERE, 'make-fixtures.js')], { stdio: 'inherit' });
  }
  execFileSync(process.execPath, [join(HERE, 'copy-assets.js')], { stdio: 'inherit' });

  const server = await createServer({
    root: ROOT,
    logLevel: 'warn',
    server: { host: '127.0.0.1', port: PORT, strictPort: true },
  });
  await server.listen();

  const browser = await chromium.launch();
  const page = await browser.newPage();
  const offsite = [];
  page.on('request', (request) => {
    const url = request.url();
    if (!url.startsWith(`http://127.0.0.1:${PORT}`) && !/^(blob|data):/.test(url))
      offsite.push(url);
  });
  page.on('console', (message) => {
    const text = message.text();
    if (text.startsWith('BENCH ')) {
      const entry = JSON.parse(text.slice(6));
      const note = entry.error
        ? `FAILED ${entry.error}`
        : `${entry.correct}/${entry.expected} right`;
      console.log(
        `  ${entry.id.padEnd(8)} ${entry.mode.padEnd(6)} ${note} (${entry.seconds.toFixed(1)} s)`
      );
    }
  });

  const query = new URLSearchParams();
  if (args.only) query.set('only', String(args.only));
  if (args.mode) query.set('mode', String(args.mode));
  console.log('Running the benchmark in a headless browser...');
  await page.goto(`http://127.0.0.1:${PORT}/bench/index.html?${query}`);
  await page.waitForFunction(() => window.__benchResults, null, { timeout: 0, polling: 1000 });
  const outcome = await page.evaluate(() => window.__benchResults);

  await browser.close();
  await server.close();

  if (outcome.error) throw new Error(outcome.error);
  if (offsite.length) {
    throw new Error(`The page asked for something off this machine: ${offsite.join(', ')}`);
  }

  const baseline = existsSync(BASELINE) ? JSON.parse(await readFile(BASELINE, 'utf8')) : null;
  const summary = report(outcome.results, args['save-baseline'] ? null : baseline);
  const saved = {
    when: new Date().toISOString(),
    environment: outcome.environment,
    summary,
    results: outcome.results,
  };
  await mkdir(RESULTS, { recursive: true });
  await writeFile(join(RESULTS, 'latest.json'), `${JSON.stringify(saved, null, 2)}\n`);
  if (args['save-baseline']) {
    await writeFile(BASELINE, `${JSON.stringify(saved, null, 2)}\n`);
    console.log('\nSaved as the baseline: bench/baseline.json');
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
