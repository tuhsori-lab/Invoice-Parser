import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { analyzePages } from '../core/analyze.js';
import { groupPages } from '../core/group.js';
import { assignFileNames, buildFileName, DEFAULT_TEMPLATE } from '../core/naming.js';
import { explain } from '../core/errors.js';
import { exportWarning, reviewQueue } from '../core/review.js';
import { createProfile } from '../core/profiles.js';
import { closeBatch, loadBatch } from '../lib/loadBatch.js';
import { clearThumbnails } from '../lib/thumbnails.js';
import { saveFile } from '../lib/download.js';
import { useDebounced } from '../lib/useDebounced.js';
import { useUndoable } from '../lib/useUndoable.js';
import { loadProfiles, saveProfiles } from '../lib/profileStore.js';
import { applyTheme, loadTheme, watchSystemTheme } from '../lib/theme.js';
import { readScannedPages, stopOcr } from '../lib/ocr.js';
import DropZone from './components/DropZone.jsx';
import SettingsPanel from './components/SettingsPanel.jsx';
import PageStrip from './components/PageStrip.jsx';
import InvoiceTable from './components/InvoiceTable.jsx';
import PreviewModal from './components/PreviewModal.jsx';
import ReviewQueue from './components/ReviewQueue.jsx';
import ConfirmDialog from './components/ConfirmDialog.jsx';
import ProfilesPanel from './components/ProfilesPanel.jsx';
import ProfileEditor from './components/ProfileEditor.jsx';
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

  // Client profiles, read back from this browser's storage on the way in.
  const [saved] = useState(loadProfiles);
  const [profiles, setProfiles] = useState(saved.profiles);
  const [activeProfiles, setActiveProfiles] = useState(saved.active);
  const [editingProfile, setEditingProfile] = useState(null);
  const [theme, setTheme] = useState(loadTheme);

  /**
   * Every fix made by hand. Kept apart from the detection settings, and apart
   * from the pages themselves, so that changing a setting re-runs detection
   * without throwing away a single thing a person decided.
   */
  const fixes = useUndoable({ boundaries: {}, numbers: {}, moves: {} });

  const [reading, setReading] = useState(null);
  const readCancelRef = useRef(null);
  const cancelRef = useRef(null);
  const sourcesRef = useRef(new Map());
  const searchRef = useRef(null);

  const settled = useDebounced(settings, 180);

  useEffect(() => {
    saveProfiles(profiles, activeProfiles);
  }, [profiles, activeProfiles]);

  const themeRef = useRef(theme);
  themeRef.current = theme;
  useEffect(() => {
    applyTheme(theme);
    return watchSystemTheme(() => themeRef.current);
  }, [theme]);

  /** The profiles switched on, in the order they are listed. */
  const profilesInUse = useMemo(
    () => profiles.filter((profile) => activeProfiles.includes(profile.id)),
    [profiles, activeProfiles]
  );

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
    setQuery('');
    setIssueAt(-1);
    fixes.reset({ boundaries: {}, numbers: {}, moves: {} });
  }, [files, fixes]);

  /* --------------------------------------------------------------- the work */

  const analyzed = useMemo(
    () =>
      analyzePages(pages, {
        profiles: profilesInUse,
        useCommonLabels: settled.useCommonLabels,
        useBareInvoice: settled.useBareInvoice,
        customPattern: settled.customPattern,
        extraLabel: settled.extraLabel,
      }),
    [
      pages,
      profilesInUse,
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
            found.has(page.index) ? { ...page, text: found.get(page.index), ocr: true } : page
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

  /* --------------------------------------------------------------- profiles */

  const saveProfile = useCallback((profile) => {
    setProfiles((current) => {
      const known = current.some((entry) => entry.id === profile.id);
      return known
        ? current.map((entry) => (entry.id === profile.id ? profile : entry))
        : [...current, profile];
    });
    setActiveProfiles((current) =>
      current.includes(profile.id) ? current : [...current, profile.id]
    );
    setEditingProfile(null);
  }, []);

  const deleteProfile = useCallback((id) => {
    setProfiles((current) => current.filter((entry) => entry.id !== id));
    setActiveProfiles((current) => current.filter((entry) => entry !== id));
    setEditingProfile(null);
  }, []);

  const toggleProfile = useCallback((id) => {
    setActiveProfiles((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]
    );
  }, []);

  const reportProblem = useCallback((message) => {
    setProblems((current) => [...current, { fileName: '', message }]);
  }, []);

  const importProfiles = useCallback((imported) => {
    setProfiles((current) => [...current, ...imported]);
    setActiveProfiles((current) => [...current, ...imported.map((profile) => profile.id)]);
  }, []);

  /**
   * Teach a label by highlighting it on a page.
   *
   * A brand new profile is given the first line of the page to recognise its
   * client by - on an invoice that is nearly always the letterhead - so the
   * next batch from them is matched without anyone doing anything.
   */
  const teachLabel = useCallback(
    (label, profileId, page) => {
      if (profileId === 'new') {
        const [letterhead = ''] = (page.text ?? '').split('\n');
        const fresh = createProfile({
          name: letterhead.trim().slice(0, 60) || 'Untitled client',
          labels: [label],
          identifyingText: letterhead.trim() ? [letterhead.trim()] : [],
        });
        saveProfile(fresh);
        return;
      }
      const existing = profiles.find((entry) => entry.id === profileId);
      if (!existing) return;
      if (existing.labels.includes(label)) return;
      saveProfile({ ...existing, labels: [...existing.labels, label] });
    },
    [profiles, saveProfile]
  );

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

      {pageCount === 0 && !loading && (
        <aside className="settings-column standalone" aria-label="Client profiles">
          <ProfilesPanel
            profiles={profiles}
            active={activeProfiles}
            onToggle={toggleProfile}
            onEdit={(id) => setEditingProfile(profiles.find((entry) => entry.id === id))}
            onAdd={() => setEditingProfile(createProfile())}
            onImport={importProfiles}
            onProblem={reportProblem}
          />
        </aside>
      )}

      {pageCount > 0 && (
        <main className="workspace">
          <div className="settings-column">
            <ProfilesPanel
              profiles={profiles}
              active={activeProfiles}
              onToggle={toggleProfile}
              onEdit={(id) => setEditingProfile(profiles.find((entry) => entry.id === id))}
              onAdd={() => setEditingProfile(createProfile())}
              onImport={importProfiles}
              onProblem={reportProblem}
            />
            <SettingsPanel
              settings={settings}
              nameExample={nameExample}
              onChange={(key, value) => setSettings((current) => ({ ...current, [key]: value }))}
            />
          </div>

          <section className="results" id="results" tabIndex={-1}>
            <div className="results-head">
              <p className="summary" data-testid="summary" role="status" aria-live="polite">
                {pageCount} {pageCount === 1 ? 'page' : 'pages'} split into {groups.length}{' '}
                {groups.length === 1 ? 'invoice' : 'invoices'}
                {needingReview > 0 && `, ${needingReview} worth a look`}.
              </p>
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
          profiles={profiles}
          onTeachLabel={teachLabel}
          onMoveToNeighbour={(direction) => {
            const anchor = previewPage.index + direction;
            if (anchor >= 1 && anchor <= pages.length) movePage(previewPage.index, anchor);
          }}
          canMoveBack={previewPage.index > 1}
          canMoveOn={previewPage.index < pages.length}
          busy={Boolean(exporting)}
        />
      )}

      {editingProfile && (
        <ProfileEditor
          profile={editingProfile}
          canDelete={profiles.some((entry) => entry.id === editingProfile.id)}
          onSave={saveProfile}
          onDelete={deleteProfile}
          onClose={() => setEditingProfile(null)}
        />
      )}

      {confirming && (
        <ConfirmDialog
          question={confirming.question}
          detail={confirming.detail}
          confirmLabel={confirming.confirmLabel}
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
