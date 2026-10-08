/**
 * The benchmark, as it runs inside the browser.
 *
 * Every sample PDF goes through exactly what the app does with a dropped file -
 * read it, find the scanned pages, read those with text recognition (taking a
 * second look where the app would), detect, group and name - using the app's
 * own modules. Then the invoices that come out are marked against the right
 * answers, and the time spent reading scans is measured.
 *
 * The question that matters most is: how many invoices came out wrong without
 * anything saying so? That number has to be zero.
 *
 * Run it with `npm run bench`, not by opening this page.
 */

import { loadBatch, closeBatch } from '../src/lib/loadBatch.js';
import { analyzePages, judgeReading } from '../src/core/analyze.js';
import { groupPages } from '../src/core/group.js';
import { assignFileNames } from '../src/core/naming.js';
import { createProfile, zonesForPage } from '../src/core/profiles.js';
import { valueShape } from '../src/core/detect.js';
import { readScannedPages, stopOcr } from '../src/lib/ocr.js';
import { measurePictures, pictureKey, scansToRead } from '../src/lib/pictures.js';
import { buildKnownList } from '../src/core/knownList.js';
import { verifyGroups } from '../src/core/verify.js';
import { isPicture } from '../src/core/scans.js';
import { CASES, SPECIAL_CASES } from '../tests/fixtures/expected.js';
import { SCAN_SUITE, boxFor, expectedGroups } from '../scripts/lib/scanSuite.js';

const FIXTURES = '/tests/fixtures/pdf/';

/** Every run the benchmark knows about. */
function scenarios() {
  const list = [];

  // The typed layouts: no text recognition, read by their labels.
  for (const entry of CASES) {
    list.push({
      id: `${entry.case}`,
      file: entry.file,
      what: entry.what,
      mode: 'labels',
      detect: entry.detect ?? {},
      group: entry.group ?? {},
      expected: entry.groups.map(({ invoice, pages }) => ({ invoice, pages })),
    });
  }

  // The older scanned samples.
  list.push({
    id: '16',
    file: SPECIAL_CASES.imageOnly.file,
    what: SPECIAL_CASES.imageOnly.what,
    mode: 'labels',
    expected: [{ invoice: '552211', pages: [1] }],
  });
  list.push({
    id: '23',
    file: SPECIAL_CASES.scannedWithNotes.file,
    what: SPECIAL_CASES.scannedWithNotes.what,
    mode: 'labels',
    expected: SPECIAL_CASES.scannedWithNotes.groups.map(({ invoice, pages }) => ({
      invoice,
      pages,
    })),
  });

  // The harder scans: once read by their labels, once with a box saved.
  for (const fixture of SCAN_SUITE) {
    const expected = expectedGroups(fixture);
    list.push({
      id: `${fixture.case}`,
      file: fixture.file,
      what: fixture.what,
      mode: 'labels',
      expected,
    });
    // As if the person had loaded their own list of open invoices.
    list.push({
      id: `${fixture.case}-list`,
      file: fixture.file,
      what: `${fixture.what}, checked against the invoice list`,
      mode: 'list',
      knownList: expected.map((group) => group.invoice),
      expected,
    });
    const box = boxFor(fixture);
    list.push({
      id: `${fixture.case}-box`,
      file: fixture.file,
      what: `${fixture.what}, with a box saved`,
      mode: 'box',
      detect: {
        profiles: [createProfile({ ...box, zoneShape: valueShape(fixture.invoices[0].number) })],
      },
      expected,
    });
  }
  return list;
}

/** Read a sample PDF the way the app reads a dropped file. */
async function load(fileName) {
  const response = await fetch(`${FIXTURES}${fileName}`);
  if (!response.ok) throw new Error(`Could not fetch ${fileName}: ${response.status}`);
  const file = new File([await response.blob()], fileName, { type: 'application/pdf' });
  return loadBatch([file]);
}

/** Reading settings under test, from the page address: ?psm=11&rotate=1. */
const settings = (() => {
  const params = new URLSearchParams(location.search);
  return {
    pageMode: params.get('psm') ? Number(params.get('psm')) : undefined,
    rotateAuto: params.get('rotate') === '1' ? true : undefined,
  };
})();

/** Run one scenario end to end, as the app would, and mark the result. */
async function run(scenario) {
  const { files, pages: loaded } = await load(scenario.file);
  const docsById = new Map(files.map((file) => [file.id, file.doc]));
  const analysis = {
    useCommonLabels: true,
    useBareInvoice: true,
    customPattern: '',
    extraLabel: '',
    ...scenario.detect,
  };
  const groupSettings = { mode: 'by-number', unnumbered: 'attach', ...scenario.group };

  let pages = loaded;
  let analyzed = analyzePages(pages, analysis);

  // Which pages are pictures of paper - asked only of pages with no number.
  const unmeasured = analyzed.filter((page) => !page.ocr && !page.detection);
  const pictures = await measurePictures(unmeasured, docsById);
  const boxed = new Set(
    groupPages(analyzed, groupSettings)
      .filter((group) => group.provenance?.source === 'zone')
      .flatMap((group) => group.pages.map((page) => page.index))
  );
  const toRead = scansToRead(analyzed, pictures, boxed);

  let ocrSeconds = 0;
  if (toRead.length > 0) {
    const started = performance.now();
    const found = await readScannedPages(toRead, docsById, {
      judge: (page, reading) => judgeReading(page, reading, analysis),
      boxFor: (page, reading) =>
        zonesForPage(reading.text, analysis.profiles ?? [], { tolerant: true })[0] ?? null,
      pageMode: settings.pageMode,
      rotateAuto: settings.rotateAuto,
    });
    ocrSeconds = (performance.now() - started) / 1000;
    pages = pages.map((page) =>
      found.has(page.index) ? { ...page, ...found.get(page.index), ocr: true } : page
    );
    analyzed = analyzePages(pages, analysis);
  }

  // The same checks the app runs before anything can go out without review.
  const knownList = scenario.knownList
    ? buildKnownList(
        scenario.knownList.map((value) => [value]),
        { invoiceColumn: 0, hasHeader: false },
        'bench-list.csv'
      )
    : null;
  const { groups } = verifyGroups(assignFileNames(groupPages(analyzed, groupSettings)), {
    knownList,
    strict: true,
    isPicture: (page) => {
      const picture = pictures.get(pictureKey(page));
      return picture ? isPicture(picture) : undefined;
    },
  });
  closeBatch(files);
  return { ...mark(scenario.expected, groups), scannedPages: toRead.length, ocrSeconds };
}

/**
 * Mark what came out against the right answer.
 *
 * An invoice that came out is right when it has exactly the pages it should and
 * the number it should; anything else is wrong. Whether it was sent for review
 * - carries any flag at all - is counted separately, and "wrong and not flagged"
 * is the number that has to be zero. Because every invoice read from a scan is
 * flagged "read from a scan" whatever else is true of it, wrong invoices whose
 * only flag is that one are counted too, to show what that blanket flag hides.
 */
function mark(expected, groups) {
  const key = (pages) => pages.join(',');
  const wanted = new Map(expected.map((entry) => [key(entry.pages), entry]));
  const result = {
    expected: expected.length,
    produced: groups.length,
    correct: 0,
    wrong: 0,
    wrongUnflagged: 0,
    wrongOnlyScanFlag: 0,
    sentToReview: 0,
    correctSplits: 0,
    details: [],
  };
  const splits = new Set();
  for (const group of groups) {
    const pages = group.pages.map((page) => page.index);
    const match = wanted.get(key(pages));
    if (match) splits.add(key(pages));
    const right = Boolean(match) && match.invoice === group.invoice;
    const flagged = group.flags.length > 0;
    if (flagged) result.sentToReview += 1;
    if (right) {
      result.correct += 1;
    } else {
      result.wrong += 1;
      if (!flagged) result.wrongUnflagged += 1;
      if (group.flags.length === 1 && group.flags[0] === 'ocr') result.wrongOnlyScanFlag += 1;
      result.details.push({
        got: group.invoice,
        pages,
        expected: match?.invoice ?? null,
        flags: group.flags,
      });
    }
  }
  result.correctSplits = splits.size;
  return result;
}

/** Run everything asked for, one at a time, and leave the results for the runner. */
async function main() {
  const params = new URLSearchParams(location.search);
  const only = params.get('only')?.split(',').filter(Boolean) ?? null;
  const mode = params.get('mode');
  const chosen = scenarios().filter(
    (scenario) =>
      (!only ||
        only.includes(scenario.id) ||
        only.includes(scenario.id.replace(/-(box|list)$/, ''))) &&
      (!mode || scenario.mode === mode)
  );

  const results = [];
  for (const scenario of chosen) {
    const started = performance.now();
    let result;
    try {
      result = await run(scenario);
    } catch (error) {
      result = { error: String(error?.message ?? error) };
    }
    const seconds = (performance.now() - started) / 1000;
    const entry = { id: scenario.id, file: scenario.file, mode: scenario.mode, seconds, ...result };
    results.push(entry);
    console.log(`BENCH ${JSON.stringify(entry)}`);
  }
  await stopOcr();
  window.__benchResults = {
    results,
    environment: { userAgent: navigator.userAgent, cores: navigator.hardwareConcurrency },
  };
  document.getElementById('log').textContent = 'Done.';
}

main().catch((error) => {
  window.__benchResults = { error: String(error?.stack ?? error) };
});
