import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { analyzePages } from '../core/analyze.js';
import { groupPages } from '../core/group.js';
import { assignFileNames, buildFileName, DEFAULT_TEMPLATE } from '../core/naming.js';
import { explain } from '../core/errors.js';
import { exportWarning, reviewQueue } from '../core/review.js';
import { createProfile, zonesForPage } from '../core/profiles.js';
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
import { readScannedPages, stopOcr } from '../lib/ocr.js';
import DropZone from './components/DropZone.jsx';
import SettingsPanel from './components/SettingsPanel.jsx';
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
  // Showing the app where the invoice number is: whether the preview was opened
  // to draw a box, and whether the ask was waved off for this batch.
  const [pointing, setPointing] = useState(false);
  const [pointDismissed, setPointDismissed] = useState(false);
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
    setProblems([]);
    setPreviewIndex(null);
    setPointing(false);
    setPointDismissed(false);
    setSavedTo(null);
    setQuery('');
    setIssueAt(-1);
    fixes.reset({ boundaries: {}, numbers: {}, moves: {} });
  }, [files, fixes]);

  /* --------------------------------------------------------------- the work */

  const analyzed = useMemo(
    () =>
      analyzePages(pages, {
        profiles: boxes,
        useCommonLabels: settled.useCommonLabels,
        useBareInvoice: settled.useBareInvoice,
        customPattern: settled.customPattern,
        extraLabel: settled.extraLabel,
      }),
    [
      pages,
      boxes,
      settled.useCommonLabels,
      settled.useBareInvoice,
      settled.customPattern,
      settled.extraLabel,
    ]
  );

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

  /** Pages that are only a picture, so nothing could be read from them. */
  const scannedPages = useMemo(() => pages.filter((page) => !page.hasText && !page.ocr), [pages]);

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
      const found = await readScannedPages(scannedPages, docsById, {
        signal,
        onProgress: setReading,
      });
      if (found.size > 0) {
        setPages((current) =>
          current.map((page) =>
            found.has(page.index)
              ? // The old layout described the page's empty text layer, so it
                // says nothing about where recognised words sit. Drop it.
                { ...page, text: found.get(page.index), layout: null, ocr: true }
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
  }, [scannedPages, docsById]);

  /* ------------------------------------------------------------------ boxes */

  /**
   * Remember a box drawn around the invoice number on a page.
   *
   * It belongs to the client that page already belongs to, if one is
   * remembered; drawing again is how somebody corrects a box that was off. A
   * page from a client not seen before starts a new one, recognised from then
   * on by the first line of their page - on an invoice, nearly always the
   * letterhead - so their next batch is read without being asked.
   *
   * @param {object} zone - fractions of the page, y from the bottom.
   * @param {object} page - the page it was drawn on.
   * @param {string} zoneShape - the shape of the number inside it.
   */
  const rememberBox = useCallback((zone, page, zoneShape = '') => {
    const known = page.matchedProfiles?.[0];
    const [letterhead = ''] = (page.text ?? '').split('\n');
    // Through createProfile, the one place that knows what a box may hold.
    const box = createProfile(
      known
        ? { ...known, zone, zoneShape }
        : {
            name: letterhead.trim().slice(0, 60) || 'Untitled client',
            identifyingText: letterhead.trim() ? [letterhead.trim()] : [],
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
  const needingReview = groups.filter((group) => group.flags.length > 0).length;
  const pageCount = pages.length;

  /**
   * Pages a box could be drawn on that no saved spot covers yet, in page order.
   * The same rule detection uses to decide which spots to read on a page, so the
   * app never asks about a page it already knows how to read.
   */
  const unpointed = useMemo(
    () =>
      analyzed.filter((page) => page.layout?.length && zonesForPage(page.text, boxes).length === 0),
    [analyzed, boxes]
  );
  const anyPointed = unpointed.length < analyzed.filter((page) => page.layout?.length).length;
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
        <main className="workspace">
          <div className="settings-column">
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

            {!pointDismissed && unpointed.length > 0 && (
              <PointPrompt
                page={unpointed[0].index}
                anyPointed={anyPointed}
                onPoint={pointAt}
                onDismiss={() => setPointDismissed(true)}
              />
            )}

            {(scannedPages.length > 0 || reading) && (
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
                    <p>
                      {scannedPages.length === pageCount
                        ? explain('no-text').text
                        : scannedPages.length === 1
                          ? 'One page has no readable text on it. It looks like a scan.'
                          : `${scannedPages.length} pages have no readable text on them. They look like scans.`}
                    </p>
                    <button
                      type="button"
                      className="button"
                      data-testid="read-scanned"
                      onClick={readScanned}
                    >
                      Read scanned pages (slower)
                    </button>
                  </>
                )}
              </div>
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
