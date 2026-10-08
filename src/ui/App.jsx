import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { analyzePages, judgeReading } from '../core/analyze.js';
import { groupPages } from '../core/group.js';
import { assignFileNames, buildFileName, DEFAULT_TEMPLATE } from '../core/naming.js';
import { explain } from '../core/errors.js';
import { exportWarning, reviewQueue } from '../core/review.js';
import { createProfile, identifyingLinesFor, zonesForPage } from '../core/profiles.js';
import { closeBatch, loadBatch } from '../lib/loadBatch.js';
import { clearThumbnails } from '../lib/thumbnails.js';
import { saveFile } from '../lib/download.js';
import {
  canSaveToFolder,
  chooseFolder,
  namesAlreadyThere,
  writeIntoFolder,
} from '../lib/saveToFolder.js';
import { useDebounced } from '../lib/useDebounced.js';
import { useUndoable } from '../lib/useUndoable.js';
import { loadBoxes, saveBoxes } from '../lib/boxStore.js';
import { applyTheme, loadTheme, watchSystemTheme } from '../lib/theme.js';
import { loadControlsOpen, saveControlsOpen } from '../lib/controlsStore.js';
import { readScannedPages, stopOcr } from '../lib/ocr.js';
import { measurePictures, pictureKey, scansToRead } from '../lib/pictures.js';
import DropZone from './components/DropZone.jsx';
import SettingsPanel from './components/SettingsPanel.jsx';
import ControlsToggle from './components/ControlsToggle.jsx';
import PageStrip from './components/PageStrip.jsx';
import InvoiceTable from './components/InvoiceTable.jsx';
import PreviewModal from './components/PreviewModal.jsx';
import PointPrompt from './components/PointPrompt.jsx';
import PurchaseOrders from './components/PurchaseOrders.jsx';
import ReviewQueue from './components/ReviewQueue.jsx';
import ConfirmDialog from './components/ConfirmDialog.jsx';
import ThemeChoice from './components/ThemeChoice.jsx';

/** What the app does before anyone changes anything. */
const INITIAL_SETTINGS = {
  mode: 'by-number',
  unnumbered: 'attach',
  combinePages: false,
  markerText: 'Page 1 of',
  pagesPerInvoice: 2,
  useCommonLabels: true,
  useBareInvoice: true,
  customPattern: '',
  extraLabel: '',
  listPurchaseOrders: true,
  prefix: '',
  template: DEFAULT_TEMPLATE,
};

/** The same object without one key, so a fix can be taken back cleanly. */
function without(record, key) {
  if (!(key in record)) return record;
  const copy = { ...record };
  delete copy[key];
  return copy;
}

/** An invoice made up purely to show what the name pattern produces. */
/**
 * What to say about the scanned pages still to be read.
 *
 * Some scans have no text at all. Others have a few words on top of the
 * picture, and saying they have no text would be untrue; what they lack is the
 * words printed on the paper, the invoice number among them.
 *
 * @param {Array<object>} scanned
 * @param {number} pageCount - pages in the whole batch.
 * @returns {string}
 */
function scannedNotice(scanned, pageCount) {
  const textless = scanned.every((page) => !page.hasText);
  if (textless && scanned.length === pageCount) return explain('no-text').text;
  if (textless) {
    return scanned.length === 1
      ? 'One page has no readable text on it. It looks like a scan.'
      : `${scanned.length} pages have no readable text on them. They look like scans.`;
  }
  return scanned.length === 1
    ? 'One page looks like a scan, so its invoice number could not be read.'
    : `${scanned.length} pages look like scans, so their invoice numbers could not be read.`;
}

const EXAMPLE_GROUP = {
  invoice: '104233',
  extra: { value: 'PO-9921' },
  client: 'Northwind Traders',
  pages: [{ index: 5 }, { index: 6 }],
  flags: [],
};

export default function App() {
  const [files, setFiles] = useState([]);
  const [pages, setPages] = useState([]);
  const [loading, setLoading] = useState(null);
  const [problems, setProblems] = useState([]);
  const [settings, setSettings] = useState(INITIAL_SETTINGS);
  // The settings sidebar, closed until somebody asks for it.
  const [controlsOpen, setControlsOpen] = useState(loadControlsOpen);
  const toggleControls = useCallback(() => {
    setControlsOpen((open) => {
      saveControlsOpen(!open);
      return !open;
    });
  }, []);
  // Compared as text: a number typed into a box comes back as a string.
  const changedSettings = Object.keys(INITIAL_SETTINGS).filter(
    (key) => String(settings[key]) !== String(INITIAL_SETTINGS[key])
  ).length;
  const [query, setQuery] = useState('');
  const [previewIndex, setPreviewIndex] = useState(null);
  const [exporting, setExporting] = useState(null);
  const [issueAt, setIssueAt] = useState(-1);
  const [confirming, setConfirming] = useState(null);

  // The boxes drawn around clients' invoice numbers, one per client, read back
  // from this browser's storage on the way in.
  const [boxes, setBoxes] = useState(loadBoxes);
  const [theme, setTheme] = useState(loadTheme);

  /**
   * Every fix made by hand. Kept apart from the detection settings, and apart
   * from the pages themselves, so that changing a setting re-runs detection
   * without throwing away a single thing a person decided.
   */
  const fixes = useUndoable({ boundaries: {}, numbers: {}, moves: {} });

  const [reading, setReading] = useState(null);
  // How much of each page is a picture, and how finely it was scanned, for the
  // pages that were asked about.
  const [pictures, setPictures] = useState(() => new Map());
  const picturesRef = useRef(pictures);
  picturesRef.current = pictures;
  // The check of which pages are pictures, while one is under way.
  const measuringRef = useRef(null);
  // Showing the app where the invoice number is: whether the preview was opened
  // to draw a box, and whether the ask was waved off for this batch.
  const [pointing, setPointing] = useState(false);
  const [pointDismissed, setPointDismissed] = useState(false);
  // Whether the offer to read scanned pages was waved off for this batch.
  const [scanDismissed, setScanDismissed] = useState(false);
  // Where the last "Save to a folder" put this batch, to say so.
  const [savedTo, setSavedTo] = useState(null);
  const readCancelRef = useRef(null);
  const cancelRef = useRef(null);
  const sourcesRef = useRef(new Map());
  const searchRef = useRef(null);

  const settled = useDebounced(settings, 180);

  useEffect(() => {
    saveBoxes(boxes);
  }, [boxes]);

  const themeRef = useRef(theme);
  themeRef.current = theme;
  useEffect(() => {
    applyTheme(theme);
    return watchSystemTheme(() => themeRef.current);
  }, [theme]);

  /* ---------------------------------------------------------------- loading */

  const startBatch = useCallback(
    async (chosen) => {
      closeBatch(files);
      clearThumbnails();
      sourcesRef.current.clear();
      setFiles([]);
      setPages([]);
      setProblems([]);
      setPreviewIndex(null);
      setPointing(false);
      setPointDismissed(false);
      setScanDismissed(false);
      setSavedTo(null);
      setQuery('');
      setIssueAt(-1);
      fixes.reset({ boundaries: {}, numbers: {}, moves: {} });

      const signal = { aborted: false };
      cancelRef.current = signal;
      setLoading({ done: 0, total: 0, fileName: chosen[0]?.name ?? '' });

      try {
        const batch = await loadBatch(chosen, { signal, onProgress: setLoading });
        if (signal.aborted) {
          closeBatch(batch.files);
          return;
        }
        setFiles(batch.files);
        setPages(batch.pages);
        setProblems(batch.problems);
      } catch (error) {
        setProblems([{ fileName: chosen[0]?.name ?? '', kind: explain(error).kind }]);
      } finally {
        cancelRef.current = null;
        setLoading(null);
      }
    },
    [files, fixes]
  );

  const clearBatch = useCallback(() => {
    closeBatch(files);
    clearThumbnails();
    sourcesRef.current.clear();
    setFiles([]);
    setPages([]);
    setPictures(new Map());
    setProblems([]);
    setPreviewIndex(null);
    setPointing(false);
    setPointDismissed(false);
    setScanDismissed(false);
    setSavedTo(null);
    setQuery('');
    setIssueAt(-1);
    fixes.reset({ boundaries: {}, numbers: {}, moves: {} });
  }, [files, fixes]);

  /* --------------------------------------------------------------- the work */

  const analysis = useMemo(
    () => ({
      profiles: boxes,
      useCommonLabels: settled.useCommonLabels,
      useBareInvoice: settled.useBareInvoice,
      customPattern: settled.customPattern,
      extraLabel: settled.extraLabel,
    }),
    [
      boxes,
      settled.useCommonLabels,
      settled.useBareInvoice,
      settled.customPattern,
      settled.extraLabel,
    ]
  );

  const analyzed = useMemo(() => analyzePages(pages, analysis), [pages, analysis]);
  // For the handlers that need the latest pages without being rebuilt for them.
  const analyzedRef = useRef(analyzed);
  analyzedRef.current = analyzed;

  const groups = useMemo(
    () =>
      assignFileNames(
        groupPages(analyzed, {
          mode: settled.mode,
          unnumbered: settled.unnumbered,
          combinePages: settled.combinePages,
          markerText: settled.markerText,
          pagesPerInvoice: Number(settled.pagesPerInvoice) || 1,
          overrides: fixes.state,
        }),
        { template: settled.template, prefix: settled.prefix }
      ),
    [analyzed, settled, fixes.state]
  );

  const groupOfPage = useMemo(() => {
    const byPage = new Map();
    for (const group of groups) for (const page of group.pages) byPage.set(page.index, group);
    return byPage;
  }, [groups]);

  const docsById = useMemo(() => new Map(files.map((file) => [file.id, file.doc])), [files]);

  /** Which colour each invoice has, so the strip, the table and the queue agree. */
  const colourOf = useMemo(
    () => new Map(groups.map((group, position) => [group.id, position])),
    [groups]
  );

  const issues = useMemo(() => reviewQueue(groups), [groups]);

  /** Pages that match the search box, or null when nothing is being searched. */
  const matchedPages = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return null;
    const matched = new Set();
    for (const group of groups) {
      const pageNumbers = group.pages.map((page) => String(page.index));
      const hit =
        group.invoice?.toLowerCase().includes(needle) ||
        group.extra?.value?.toLowerCase().includes(needle) ||
        group.fileName?.toLowerCase().includes(needle) ||
        pageNumbers.some((number) => number === needle);
      if (hit) for (const page of group.pages) matched.add(page.index);
    }
    return matched;
  }, [groups, query]);

  const shownGroups = useMemo(
    () =>
      matchedPages === null
        ? groups
        : groups.filter((group) => group.pages.some((page) => matchedPages.has(page.index))),
    [groups, matchedPages]
  );

  const nameExample = useMemo(
    () => buildFileName(EXAMPLE_GROUP, { template: settled.template, prefix: settled.prefix }),
    [settled.template, settled.prefix]
  );

  /* ------------------------------------------------------------ fixing by hand */

  /** Start a new invoice at this page. */
  const splitAt = useCallback(
    (pageIndex) => {
      fixes.set((current) => ({
        ...current,
        boundaries: { ...current.boundaries, [pageIndex]: 'split' },
      }));
    },
    [fixes]
  );

  /** Put this page back with the invoice before it. */
  const joinAt = useCallback(
    (pageIndex) => {
      fixes.set((current) => ({
        ...current,
        boundaries: { ...current.boundaries, [pageIndex]: 'join' },
        // A page that was moved somewhere else cannot also join its neighbour.
        moves: without(current.moves, pageIndex),
      }));
    },
    [fixes]
  );

  /** Put this page in the same invoice as that one. */
  const movePage = useCallback(
    (pageIndex, ontoPageIndex) => {
      fixes.set((current) => ({
        ...current,
        boundaries: without(current.boundaries, pageIndex),
        moves: { ...current.moves, [pageIndex]: ontoPageIndex },
      }));
    },
    [fixes]
  );

  /** Correct an invoice number by hand. */
  const renameInvoice = useCallback(
    (groupId, value) => {
      fixes.set((current) => ({ ...current, numbers: { ...current.numbers, [groupId]: value } }));
    },
    [fixes]
  );

  /* ------------------------------------------------------- scanned pages */

  /*
   * A page with a number in its text is read, whatever else is on it. A page
   * without one may be a scan with a few words on top of the picture - a stamp,
   * a table pasted in - but not the words printed on the paper. Those are told
   * apart by how much of the page is an image, which is only asked about pages
   * that came out with no number, so an ordinary batch hardly pays for it.
   */
  useEffect(() => {
    const unmeasured = analyzed.filter(
      (page) => !page.ocr && !page.detection && !pictures.has(pictureKey(page))
    );
    if (unmeasured.length === 0) return undefined;
    const signal = { aborted: false };
    const measuring = measurePictures(unmeasured, docsById, signal).then((found) => {
      // What was measured stays true of that page, even if the batch moved on.
      if (found.size > 0) setPictures((current) => new Map([...current, ...found]));
      if (measuringRef.current === measuring) measuringRef.current = null;
      return found;
    });
    measuringRef.current = measuring;
    return () => {
      signal.aborted = true;
    };
  }, [analyzed, docsById, pictures]);

  /** Pages that are pictures of paper, and not yet read, so no number came from them. */
  const boxedPages = useMemo(
    () =>
      new Set(
        groups
          .filter((group) => group.provenance?.source === 'zone')
          .flatMap((group) => group.pages.map((page) => page.index))
      ),
    [groups]
  );
  const scannedPages = useMemo(
    () => scansToRead(analyzed, pictures, boxedPages),
    [analyzed, pictures, boxedPages]
  );
  const scannedIndexes = useMemo(
    () => new Set(scannedPages.map((page) => page.index)),
    [scannedPages]
  );

  /**
   * What a reading of a scanned page gives, by the same rules as every other
   * page, so that an unsure one can be read again and the better one kept.
   */
  const judge = useCallback((page, reading) => judgeReading(page, reading, analysis), [analysis]);

  /**
   * Read the scanned pages, one at a time, and put what was found back into
   * the same pipeline as everything else. Those pages are marked as having come
   * from a scan, which is what flags their invoices for a second look.
   */
  const readScanned = useCallback(async () => {
    const signal = { aborted: false };
    readCancelRef.current = signal;
    setReading({ done: 0, total: scannedPages.length, pageIndex: scannedPages[0]?.index ?? 0 });

    try {
      // The pages with a few words on them take a moment to be recognised as
      // scans. Asked to read before that is done, wait for it, so that one
      // click reads every scanned page rather than only the ones known so far.
      let toRead = scannedPages;
      if (measuringRef.current) {
        const measured = await measuringRef.current;
        toRead = scansToRead(
          analyzedRef.current,
          new Map([...picturesRef.current, ...measured]),
          boxedPages
        );
        setReading({ done: 0, total: toRead.length, pageIndex: toRead[0]?.index ?? 0 });
      }

      const found = await readScannedPages(toRead, docsById, {
        signal,
        onProgress: setReading,
        judge,
      });
      if (found.size > 0) {
        setPages((current) =>
          current.map((page) =>
            found.has(page.index)
              ? // What was read replaces whatever words sat on top of the picture,
                // and where each word sat replaces where they did: a scan is read
                // for everything printed on it, those words included.
                { ...page, ...found.get(page.index), ocr: true }
              : page
          )
        );
      }
    } catch (error) {
      setProblems((current) => [
        ...current,
        {
          fileName: '',
          message: `Text recognition could not start: ${error.message}. Nothing was changed.`,
        },
      ]);
    } finally {
      readCancelRef.current = null;
      setReading(null);
      await stopOcr();
    }
  }, [scannedPages, docsById, judge, boxedPages]);

  /* ------------------------------------------------------------------ boxes */

  /**
   * Remember a box drawn around the invoice number on a page.
   *
   * It belongs to the client that page already belongs to, if one is
   * remembered; drawing again is how somebody corrects a box that was off. A
   * page from a client not seen before starts a new one, recognised from then
   * on by the first line of their page - on an invoice, nearly always the
   * letterhead - so their next batch is read without being asked. A client seen
   * on a scan is recognised by the lines at the top of the page that recur
   * across the batch instead (see identifyingLinesFor).
   *
   * @param {object} zone - fractions of the page, y from the bottom.
   * @param {object} page - the page it was drawn on.
   * @param {string} zoneShape - the shape of the number inside it.
   * @param {string} [value] - the number itself: used to leave lines carrying it
   *   out of what is remembered, and not kept.
   */
  const rememberBox = useCallback((zone, page, zoneShape = '', value = '') => {
    const known = page.matchedProfiles?.[0];
    const lines = identifyingLinesFor(page, analyzedRef.current, {
      leaveOut: value,
      zone,
      shape: zoneShape,
    });
    // Through createProfile, the one place that knows what a box may hold.
    const box = createProfile(
      known
        ? { ...known, zone, zoneShape }
        : {
            name: (lines[0] ?? '').slice(0, 60) || 'Untitled client',
            identifyingText: lines,
            zone,
            zoneShape,
          }
    );
    setBoxes((current) =>
      current.some((entry) => entry.id === box.id)
        ? current.map((entry) => (entry.id === box.id ? box : entry))
        : [...current, box]
    );
  }, []);

  /** Forget the box for one client, so their pages are read by their wording again. */
  const forgetBox = useCallback((id) => {
    setBoxes((current) => current.filter((entry) => entry.id !== id));
  }, []);

  /** Forget every box, after asking: it cannot be undone. */
  const askThenForgetAll = useCallback(() => {
    setConfirming({
      question:
        boxes.length === 1
          ? 'Forget the box for the one client remembered?'
          : `Forget the boxes for all ${boxes.length} clients remembered?`,
      detail:
        'Their pages are read by their wording again, and the app asks to be shown the number the next time it sees them.',
      confirmLabel: 'Yes, forget them',
      act: () => setBoxes([]),
    });
  }, [boxes.length]);

  /* ----------------------------------------------------------------- export */

  /**
   * The code that builds PDFs and ZIPs is most of this app's weight and is not
   * needed until somebody exports something, so it is fetched at that point
   * rather than on the way in. It still comes from this app's own files.
   */
  const exportTools = useCallback(() => import('../core/export.js'), []);

  /** Load each source file into pdf-lib once, and keep it for every export. */
  const sourcesFor = useCallback(
    async (wanted) => {
      const needed = new Set(wanted.flatMap((group) => group.pages.map((page) => page.fileId)));
      const missing = [...needed].filter((fileId) => !sourcesRef.current.has(fileId));
      if (missing.length > 0) {
        const { PDFDocument } = await import('pdf-lib');
        for (const fileId of missing) {
          const file = files.find((entry) => entry.id === fileId);
          if (!file) continue;
          sourcesRef.current.set(fileId, await PDFDocument.load(file.bytes));
        }
      }
      return sourcesRef.current;
    },
    [files]
  );

  const downloadInvoice = useCallback(
    async (group) => {
      setExporting({ what: group.fileName });
      try {
        const { buildInvoicePdf } = await exportTools();
        const sources = await sourcesFor([group]);
        saveFile(await buildInvoicePdf(group, sources), group.fileName, 'application/pdf');
      } catch (error) {
        setProblems((current) => [
          ...current,
          { fileName: group.fileName, kind: explain(error).kind },
        ]);
      } finally {
        setExporting(null);
      }
    },
    [sourcesFor, exportTools]
  );

  const downloadZip = useCallback(async () => {
    setExporting({ what: 'all invoices', done: 0, total: groups.length });
    try {
      const { buildAllInvoicePdfs, buildZip } = await exportTools();
      const sources = await sourcesFor(groups);
      const built = await buildAllInvoicePdfs(groups, sources, {
        onProgress: (done, total) => setExporting({ what: 'all invoices', done, total }),
      });
      const zip = await buildZip(built, { type: 'blob' });
      saveFile(zip, 'invoices.zip', 'application/zip');
    } catch (error) {
      setProblems((current) => [
        ...current,
        { fileName: 'invoices.zip', kind: explain(error).kind },
      ]);
    } finally {
      setExporting(null);
    }
  }, [groups, sourcesFor, exportTools]);

  const downloadCsv = useCallback(async () => {
    const { buildCsv } = await exportTools();
    saveFile(buildCsv(groups), 'page-map.csv', 'text/csv;charset=utf-8');
  }, [groups, exportTools]);

  /** Exporting with problems left is allowed, but never by accident. */
  const askThenExport = useCallback(() => {
    if (issues.length === 0) {
      downloadZip();
      return;
    }
    setConfirming({
      question: exportWarning(issues.length),
      detail:
        'Every invoice is saved, including the ones that need a look. An invoice with no number is named after its pages.',
      confirmLabel: 'Export anyway',
      act: downloadZip,
    });
  }, [issues.length, downloadZip]);

  /**
   * Save every invoice straight into a folder the person picks, one PDF each.
   *
   * The folder is asked for first, while the click that asked for it still
   * counts: browsers only show the picker in answer to something just done. A
   * file of the same name already in the folder is only replaced after asking.
   */
  const saveIntoFolder = useCallback(async () => {
    let folder;
    try {
      folder = await chooseFolder();
    } catch {
      setProblems((current) => [
        ...current,
        {
          fileName: '',
          message:
            'The browser would not let the app save into that folder. Choose another one, or download the ZIP instead.',
        },
      ]);
      return;
    }
    if (!folder) return;

    const write = async () => {
      const total = groups.length;
      setExporting({ what: 'folder', phase: 'Building', done: 0, total });
      try {
        const { buildAllInvoicePdfs } = await exportTools();
        const sources = await sourcesFor(groups);
        const built = await buildAllInvoicePdfs(groups, sources, {
          onProgress: (done) => setExporting({ what: 'folder', phase: 'Building', done, total }),
        });
        await writeIntoFolder(folder, built, {
          onProgress: (done) => setExporting({ what: 'folder', phase: 'Saving', done, total }),
        });
        setSavedTo({ folder: folder.name, count: built.length });
      } catch (error) {
        setProblems((current) => [
          ...current,
          error?.name === 'NotAllowedError'
            ? {
                fileName: folder.name,
                message:
                  'The browser was not allowed to save into that folder. Choose another one, or download the ZIP instead.',
              }
            : { fileName: folder.name, kind: explain(error).kind },
        ]);
      } finally {
        setExporting(null);
      }
    };

    const taken = await namesAlreadyThere(
      folder,
      groups.map((group) => group.fileName)
    );
    if (taken.length === 0) {
      await write();
      return;
    }
    setConfirming({
      question:
        taken.length === 1
          ? `${taken[0]} is already in \u201c${folder.name}\u201d. Replace it?`
          : `${taken.length} of these files are already in \u201c${folder.name}\u201d. Replace them?`,
      detail: 'The files there now are overwritten. Nothing else in the folder is touched.',
      confirmLabel: taken.length === 1 ? 'Replace it' : 'Replace them',
      cancelLabel: 'Cancel',
      act: write,
    });
  }, [groups, sourcesFor, exportTools]);

  /** The same warning as the ZIP, before anything with problems left is saved. */
  const askThenSaveIntoFolder = useCallback(() => {
    if (issues.length === 0) {
      saveIntoFolder();
      return;
    }
    setConfirming({
      question: exportWarning(issues.length),
      detail:
        'Every invoice is saved, including the ones that need a look. An invoice with no number is named after its pages.',
      confirmLabel: 'Export anyway',
      act: saveIntoFolder,
    });
  }, [issues.length, saveIntoFolder]);

  /* -------------------------------------------------------------- shortcuts */

  /** Step to the next thing that needs a look, wrapping round at the end. */
  const goToNextIssue = useCallback(() => {
    if (issues.length === 0) return;
    const next = (issueAt + 1) % issues.length;
    setIssueAt(next);
    setPreviewIndex(issues[next].group.pages[0].index);
  }, [issues, issueAt]);

  useEffect(() => {
    const onKey = (event) => {
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target?.tagName);

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) fixes.redo();
        else fixes.undo();
        return;
      }
      if (typing || previewIndex !== null || confirming) return;

      if (event.key === '/') {
        event.preventDefault();
        searchRef.current?.focus();
      } else if (event.key === 'n' || event.key === 'N') {
        event.preventDefault();
        goToNextIssue();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [previewIndex, confirming, fixes, goToNextIssue]);

  const stepPreview = useCallback(
    (by) => {
      setPreviewIndex((current) => {
        if (current === null) return null;
        return Math.min(Math.max(current + by, 1), pages.length);
      });
    },
    [pages.length]
  );

  /* ------------------------------------------------------------------- view */

  const previewPage = previewIndex === null ? null : analyzed[previewIndex - 1];
  // What a box drawn on the page in the preview would be saved under, worked
  // out the same way rememberBox does it, so the two never disagree.
  const previewClientName = useMemo(
    () =>
      previewPage && !previewPage.matchedProfiles?.length
        ? (identifyingLinesFor(previewPage, analyzed)[0] ?? '').slice(0, 60)
        : '',
    [previewPage, analyzed]
  );
  const needingReview = groups.filter((group) => group.flags.length > 0).length;
  const pageCount = pages.length;

  // Any page with text a box could be read from: a scanner's own reading of a
  // page is as good a place to draw one as a typed page. Not a page printed word
  // for word more than once in the batch, though - terms of sale after every
  // invoice, the same remittance slip - since an invoice carries a number of its
  // own and is never the same twice, so there is nothing on it to point at.
  const pointable = useMemo(() => {
    const copies = new Map();
    for (const page of analyzed) copies.set(page.text, (copies.get(page.text) ?? 0) + 1);
    return analyzed.filter((page) => page.layout?.length && copies.get(page.text) === 1);
  }, [analyzed]);

  /**
   * Pages a box could be drawn on that no saved spot covers yet, in page order.
   * The same rule detection uses to decide which spots to read on a page, so the
   * app never asks about a page it already knows how to read.
   */
  const unpointed = useMemo(
    () =>
      pointable.filter(
        (page) => zonesForPage(page.text, boxes, { tolerant: Boolean(page.ocr) }).length === 0
      ),
    [pointable, boxes]
  );
  const anyPointed = unpointed.length < pointable.length;
  const spotInvoices = groups.filter((group) => group.provenance?.source === 'zone').length;

  const pointAt = useCallback((pageIndex) => {
    setPointing(true);
    setPreviewIndex(pageIndex);
  }, []);

  return (
    <div className="app">
      <a className="skip-link" href="#results">
        Skip to the invoices
      </a>

      <header className="masthead">
        <h1>Invoice Splitter</h1>
        <p className="masthead-note">
          Your files never leave this browser. There is no server to send them to.
        </p>
        <ThemeChoice theme={theme} onChange={setTheme} />
      </header>

      <DropZone
        files={files}
        pageCount={pageCount}
        onFiles={startBatch}
        onClear={clearBatch}
        busy={Boolean(loading)}
      />

      {loading && (
        <div className="progress" role="status">
          <p>
            Reading {loading.fileName} &mdash; page {loading.done} of {loading.total || '?'}
          </p>
          <div className="progress-track">
            <div
              className="progress-bar"
              style={{ width: `${loading.total ? (loading.done / loading.total) * 100 : 5}%` }}
            />
          </div>
          <button
            type="button"
            className="button quiet"
            onClick={() => {
              if (cancelRef.current) cancelRef.current.aborted = true;
            }}
          >
            Cancel
          </button>
        </div>
      )}

      {problems.length > 0 && (
        <div className="problems" role="alert" data-testid="problems">
          <ul>
            {problems.map((problem, position) => {
              if (problem.message) {
                return <li key={`said-${position}`}>{problem.message}</li>;
              }
              const message = explain(problem.kind, { fileName: problem.fileName });
              return (
                <li key={`${problem.fileName}-${position}`}>
                  <strong>{message.what}</strong> {message.next}
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            className="icon-button"
            aria-label="Dismiss these messages"
            data-testid="dismiss-problems"
            onClick={() => setProblems([])}
          >
            &times;
          </button>
        </div>
      )}

      {pageCount > 0 && (
        <main className={`workspace${controlsOpen ? ' controls-open' : ''}`}>
          <ControlsToggle open={controlsOpen} onToggle={toggleControls} changed={changedSettings} />
          <div className="settings-column" id="advanced-controls" hidden={!controlsOpen}>
            <SettingsPanel
              settings={settings}
              nameExample={nameExample}
              onChange={(key, value) => setSettings((current) => ({ ...current, [key]: value }))}
              rememberedBoxes={boxes.length}
              onForgetBoxes={askThenForgetAll}
            />
          </div>

          <section className="results" id="results" tabIndex={-1}>
            <div className="results-head">
              <p className="summary" data-testid="summary" role="status" aria-live="polite">
                {pageCount} {pageCount === 1 ? 'page' : 'pages'} split into {groups.length}{' '}
                {groups.length === 1 ? 'invoice' : 'invoices'}
                {needingReview > 0 && `, ${needingReview} worth a look`}.
              </p>
              {savedTo && (
                <p className="saved-to" role="status" data-testid="saved-to">
                  Saved {savedTo.count === 1 ? '1 invoice' : `${savedTo.count} invoices`} to &ldquo;
                  {savedTo.folder}&rdquo;.
                </p>
              )}
              <div className="results-tools">
                <span className="undo-pair">
                  <button
                    type="button"
                    className="button quiet"
                    onClick={fixes.undo}
                    disabled={!fixes.canUndo}
                    title="Undo your last fix (Ctrl+Z)"
                    data-testid="undo"
                  >
                    Undo
                  </button>
                  <button
                    type="button"
                    className="button quiet"
                    onClick={fixes.redo}
                    disabled={!fixes.canRedo}
                    title="Redo (Ctrl+Shift+Z)"
                    data-testid="redo"
                  >
                    Redo
                  </button>
                </span>
                <label className="search">
                  <span className="visually-hidden">Search invoices</span>
                  <input
                    ref={searchRef}
                    type="search"
                    placeholder="Search invoice, extra or page number"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    data-testid="search"
                  />
                </label>
                <button
                  type="button"
                  className="button"
                  onClick={askThenExport}
                  disabled={Boolean(exporting)}
                  data-testid="download-zip"
                >
                  {exporting?.what === 'all invoices'
                    ? `Building ${exporting.done}/${exporting.total}…`
                    : 'Download all as ZIP'}
                </button>
                {canSaveToFolder() && (
                  <button
                    type="button"
                    className="button quiet"
                    onClick={askThenSaveIntoFolder}
                    disabled={Boolean(exporting)}
                    data-testid="save-folder"
                    title="Choose a folder, and every invoice is saved into it as its own PDF"
                  >
                    {exporting?.what === 'folder'
                      ? `${exporting.phase} ${exporting.done}/${exporting.total}…`
                      : 'Save to a folder…'}
                  </button>
                )}
                <button
                  type="button"
                  className="button quiet"
                  onClick={downloadCsv}
                  data-testid="download-csv"
                >
                  Download page map
                </button>
              </div>
            </div>

            {((scannedPages.length > 0 && !scanDismissed) || reading) && (
              <div className="scanned" data-testid="scanned-notice">
                {reading ? (
                  <>
                    <p>
                      Reading page {reading.pageIndex} &mdash; {reading.done} of {reading.total}{' '}
                      done. This is slow; you can stop at any point and keep what has been read.
                    </p>
                    <div className="progress-track">
                      <div
                        className="progress-bar"
                        style={{
                          width: `${reading.total ? (reading.done / reading.total) * 100 : 0}%`,
                        }}
                      />
                    </div>
                    <button
                      type="button"
                      className="button quiet"
                      data-testid="stop-reading"
                      onClick={() => {
                        if (readCancelRef.current) readCancelRef.current.aborted = true;
                      }}
                    >
                      Stop
                    </button>
                  </>
                ) : (
                  <>
                    <p>{scannedNotice(scannedPages, pageCount)}</p>
                    <button
                      type="button"
                      className="button"
                      data-testid="read-scanned"
                      onClick={readScanned}
                    >
                      Read scanned pages (slower)
                    </button>
                    {/* A scan whose own text was good enough to draw a box on
                        needs no reading, so the offer can be waved off. */}
                    <button
                      type="button"
                      className="link-button"
                      data-testid="scanned-dismiss"
                      onClick={() => setScanDismissed(true)}
                    >
                      Not now
                    </button>
                  </>
                )}
              </div>
            )}

            {/* Scans are read first: a box on a scan finds nothing until then. */}
            {!reading && !pointDismissed && unpointed.length > 0 && (
              <PointPrompt
                page={unpointed[0].index}
                anyPointed={anyPointed}
                onPoint={pointAt}
                onDismiss={() => setPointDismissed(true)}
              />
            )}

            <PageStrip
              groups={groups}
              docsById={docsById}
              matchedPages={matchedPages}
              boundaries={fixes.state.boundaries}
              onOpenPage={setPreviewIndex}
              onSplit={splitAt}
              onJoin={joinAt}
              onMovePage={movePage}
            />

            <ReviewQueue
              items={issues}
              colourOf={colourOf}
              current={issueAt}
              onGo={goToNextIssue}
              onOpenPage={setPreviewIndex}
            />

            {shownGroups.length === 0 ? (
              <p className="empty">
                Nothing matches &ldquo;{query}&rdquo;. Try an invoice number, an extra value, or a
                page number.
              </p>
            ) : (
              <InvoiceTable
                groups={shownGroups}
                colourOf={colourOf}
                onPreview={setPreviewIndex}
                onDownload={downloadInvoice}
                onRename={renameInvoice}
                busy={Boolean(exporting)}
              />
            )}

            {settings.listPurchaseOrders && (
              <PurchaseOrders
                groups={shownGroups}
                colourOf={colourOf}
                onOpenPage={setPreviewIndex}
              />
            )}
          </section>
        </main>
      )}

      {previewPage && (
        <PreviewModal
          page={previewPage}
          group={groupOfPage.get(previewPage.index)}
          doc={docsById.get(previewPage.fileId)}
          onClose={() => {
            setPreviewIndex(null);
            setPointing(false);
          }}
          onStep={stepPreview}
          onDownload={downloadInvoice}
          onTeachZone={rememberBox}
          onForgetBox={forgetBox}
          pointing={pointing}
          unreadScan={scannedIndexes.has(previewPage.index)}
          newClientName={previewClientName}
          spotInvoices={spotInvoices}
          onMoveToNeighbour={(direction) => {
            const anchor = previewPage.index + direction;
            if (anchor >= 1 && anchor <= pages.length) movePage(previewPage.index, anchor);
          }}
          canMoveBack={previewPage.index > 1}
          canMoveOn={previewPage.index < pages.length}
          busy={Boolean(exporting)}
        />
      )}

      {confirming && (
        <ConfirmDialog
          question={confirming.question}
          detail={confirming.detail}
          confirmLabel={confirming.confirmLabel}
          cancelLabel={confirming.cancelLabel}
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            const act = confirming.act;
            setConfirming(null);
            act();
          }}
        />
      )}
    </div>
  );
}
