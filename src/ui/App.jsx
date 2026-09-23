import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PDFDocument } from 'pdf-lib';
import { analyzePages } from '../core/analyze.js';
import { groupPages } from '../core/group.js';
import { assignFileNames, buildFileName, DEFAULT_TEMPLATE } from '../core/naming.js';
import { buildAllInvoicePdfs, buildCsv, buildInvoicePdf, buildZip } from '../core/export.js';
import { explain } from '../core/errors.js';
import { closeBatch, loadBatch } from '../lib/loadBatch.js';
import { clearThumbnails } from '../lib/thumbnails.js';
import { saveFile } from '../lib/download.js';
import { useDebounced } from '../lib/useDebounced.js';
import DropZone from './components/DropZone.jsx';
import SettingsPanel from './components/SettingsPanel.jsx';
import PageStrip from './components/PageStrip.jsx';
import InvoiceTable from './components/InvoiceTable.jsx';
import PreviewModal from './components/PreviewModal.jsx';

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
  prefix: '',
  template: DEFAULT_TEMPLATE,
};

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

  const cancelRef = useRef(null);
  const sourcesRef = useRef(new Map());
  const searchRef = useRef(null);

  const settled = useDebounced(settings, 180);

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
      setQuery('');

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
    [files]
  );

  const clearBatch = useCallback(() => {
    closeBatch(files);
    clearThumbnails();
    sourcesRef.current.clear();
    setFiles([]);
    setPages([]);
    setProblems([]);
    setPreviewIndex(null);
    setQuery('');
  }, [files]);

  /* --------------------------------------------------------------- the work */

  const analyzed = useMemo(
    () =>
      analyzePages(pages, {
        useCommonLabels: settled.useCommonLabels,
        useBareInvoice: settled.useBareInvoice,
        customPattern: settled.customPattern,
        extraLabel: settled.extraLabel,
      }),
    [
      pages,
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
        }),
        { template: settled.template, prefix: settled.prefix }
      ),
    [analyzed, settled]
  );

  const groupOfPage = useMemo(() => {
    const byPage = new Map();
    for (const group of groups) for (const page of group.pages) byPage.set(page.index, group);
    return byPage;
  }, [groups]);

  const docsById = useMemo(() => new Map(files.map((file) => [file.id, file.doc])), [files]);

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

  /* ----------------------------------------------------------------- export */

  /** Load each source file into pdf-lib once, and keep it for every export. */
  const sourcesFor = useCallback(
    async (wanted) => {
      const needed = new Set(wanted.flatMap((group) => group.pages.map((page) => page.fileId)));
      for (const fileId of needed) {
        if (sourcesRef.current.has(fileId)) continue;
        const file = files.find((entry) => entry.id === fileId);
        if (!file) continue;
        sourcesRef.current.set(fileId, await PDFDocument.load(file.bytes));
      }
      return sourcesRef.current;
    },
    [files]
  );

  const downloadInvoice = useCallback(
    async (group) => {
      setExporting({ what: group.fileName });
      try {
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
    [sourcesFor]
  );

  const downloadZip = useCallback(async () => {
    setExporting({ what: 'all invoices', done: 0, total: groups.length });
    try {
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
  }, [groups, sourcesFor]);

  const downloadCsv = useCallback(() => {
    saveFile(buildCsv(groups), 'page-map.csv', 'text/csv;charset=utf-8');
  }, [groups]);

  /* -------------------------------------------------------------- shortcuts */

  useEffect(() => {
    const onKey = (event) => {
      if (event.key !== '/' || previewIndex !== null) return;
      const tag = event.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [previewIndex]);

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

  return (
    <div className="app">
      <header className="masthead">
        <h1>Invoice Splitter</h1>
        <p className="masthead-note">
          Your files never leave this browser. There is no server to send them to.
        </p>
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
        <ul className="problems" data-testid="problems">
          {problems.map((problem, position) => {
            const message = explain(problem.kind, { fileName: problem.fileName });
            return (
              <li key={`${problem.fileName}-${position}`}>
                <strong>{message.what}</strong> {message.next}
              </li>
            );
          })}
        </ul>
      )}

      {pageCount > 0 && (
        <main className="workspace">
          <SettingsPanel
            settings={settings}
            nameExample={nameExample}
            onChange={(key, value) => setSettings((current) => ({ ...current, [key]: value }))}
          />

          <section className="results">
            <div className="results-head">
              <p className="summary" data-testid="summary">
                {pageCount} {pageCount === 1 ? 'page' : 'pages'} split into {groups.length}{' '}
                {groups.length === 1 ? 'invoice' : 'invoices'}
                {needingReview > 0 && `, ${needingReview} worth a look`}.
              </p>
              <div className="results-tools">
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
                  onClick={downloadZip}
                  disabled={Boolean(exporting)}
                  data-testid="download-zip"
                >
                  {exporting?.what === 'all invoices'
                    ? `Building ${exporting.done}/${exporting.total}…`
                    : 'Download all as ZIP'}
                </button>
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

            <PageStrip
              groups={groups}
              docsById={docsById}
              matchedPages={matchedPages}
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
                onPreview={setPreviewIndex}
                onDownload={downloadInvoice}
                busy={Boolean(exporting)}
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
          onClose={() => setPreviewIndex(null)}
          onStep={stepPreview}
          onDownload={downloadInvoice}
          busy={Boolean(exporting)}
        />
      )}
    </div>
  );
}
