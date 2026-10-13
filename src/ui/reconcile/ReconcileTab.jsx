import { useCallback, useMemo, useRef, useState } from 'react';
import { explain } from '../../core/errors.js';
import { cleanPrefixes } from '../../core/reconcile/normalize.js';
import { reconcile } from '../../core/reconcile/match.js';
import { guessSheetLayout, sheetEntries } from '../../core/reconcile/sheet.js';
import { readInvoicePdfs, readScannedPdfs } from '../../lib/readInvoicePdfs.js';
import { isSheetFile, readWorkbook, SheetFileError, writeWorkbook } from '../../lib/sheets.js';
import { saveFile } from '../../lib/download.js';
import { isPdfFile } from '../../lib/droppedFiles.js';
import EmptyState from '../common/EmptyState.jsx';
import { useToast } from '../common/Toasts.jsx';
import PdfInput from './PdfInput.jsx';
import SheetInput from './SheetInput.jsx';
import ResultSection from './ResultSection.jsx';
import PdfPreview from './PdfPreview.jsx';

/** Where a PDF's number came from, in words. */
const FOUND_BY = { text: 'PDF text', scan: 'Scan', filename: 'File name' };

/** Why a file could not be checked, in words. */
function whyUnchecked(item) {
  if (item.problem) return explain(item.problem, { fileName: item.fileName }).what;
  return item.scan
    ? 'A scan with no text, and no number in its name. Try "Read scanned files".'
    : 'No invoice number was found in its text or its name.';
}

/**
 * The Reconcile tab: a folder of invoice PDFs on one side, a spreadsheet on
 * the other, and what is on one but not the other.
 */
export default function ReconcileTab({ prefixes }) {
  const toast = useToast();
  const [items, setItems] = useState([]);
  const [reading, setReading] = useState(null);
  const [scanReading, setScanReading] = useState(null);
  const cancelRef = useRef(null);

  const [workbook, setWorkbook] = useState(null);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [layout, setLayout] = useState({ headerRow: -1, invoiceColumn: 0, headers: [] });
  const [carry, setCarry] = useState([]);
  const [sheetError, setSheetError] = useState('');
  const [preview, setPreview] = useState(null);

  /* ------------------------------------------------------------------ PDFs */

  const addPdfs = useCallback(
    async (found) => {
      // Only PDFs: a dropped folder often holds other files too.
      const pdfs = found.filter(({ file }) => isPdfFile(file));
      const skipped = found.length - pdfs.length;
      if (pdfs.length === 0) {
        toast(
          found.length === 1
            ? `${found[0].file.name} is not a PDF. Drop invoice PDFs here, and the spreadsheet on the right.`
            : 'None of those files are PDFs.',
          { kind: 'error' }
        );
        return;
      }
      if (skipped > 0) {
        toast(
          `Skipped ${skipped === 1 ? '1 file that is' : `${skipped} files that are`} not a PDF.`,
          {
            kind: 'info',
          }
        );
      }
      // The same file dropped twice is read once.
      const seen = new Set(items.map((item) => `${item.path}|${item.file.size}`));
      const fresh = pdfs.filter(({ file, path }) => !seen.has(`${path}|${file.size}`));
      if (fresh.length === 0) {
        toast('Those files are already here.', { kind: 'info' });
        return;
      }
      const signal = { aborted: false };
      cancelRef.current = signal;
      setReading({ done: 0, total: fresh.length, fileName: fresh[0].file.name });
      try {
        const read = await readInvoicePdfs(fresh, { signal, onProgress: setReading });
        setItems((current) => [...current, ...read]);
        const bad = read.filter((item) => item.problem).length;
        toast(
          `Read ${read.length === 1 ? '1 file' : `${read.length} files`}${
            signal.aborted ? ' before stopping' : ''
          }${bad ? `; ${bad} could not be opened` : ''}.`,
          { kind: bad || signal.aborted ? 'info' : 'success' }
        );
      } finally {
        cancelRef.current = null;
        setReading(null);
      }
    },
    [items, toast]
  );

  const readScans = useCallback(async () => {
    const scans = items.filter((item) => item.scan && item.source !== 'scan');
    if (scans.length === 0) return;
    const signal = { aborted: false };
    cancelRef.current = signal;
    setScanReading({ done: 0, total: scans.length });
    try {
      const found = await readScannedPdfs(scans, { signal, onProgress: setScanReading });
      setItems((current) =>
        current.map((item) =>
          found.has(item.id) ? { ...item, invoice: found.get(item.id), source: 'scan' } : item
        )
      );
      toast(
        `Found a number on ${found.size} of ${scans.length} scanned ${scans.length === 1 ? 'file' : 'files'}.`,
        { kind: found.size < scans.length ? 'info' : 'success' }
      );
    } catch (error) {
      toast(`Text recognition could not start: ${error.message}`, { kind: 'error' });
    } finally {
      cancelRef.current = null;
      setScanReading(null);
    }
  }, [items, toast]);

  /* ----------------------------------------------------------- spreadsheet */

  const loadSheet = useCallback(
    async (found) => {
      setSheetError('');
      const chosen = found.find(({ file }) => isSheetFile(file)) ?? found[0];
      try {
        const sheets = await readWorkbook(chosen.file);
        const first = Math.max(
          0,
          sheets.findIndex((sheet) => sheet.rows.some((row) => row.some((cell) => cell.trim())))
        );
        setWorkbook({ fileName: chosen.file.name, sheets });
        setSheetIndex(first);
        setLayout(guessSheetLayout(sheets[first].rows));
        setCarry([]);
      } catch (error) {
        const message =
          error instanceof SheetFileError ? error.message : 'This file could not be read.';
        setSheetError(message);
        toast(message, { kind: 'error' });
      }
    },
    [toast]
  );

  const chooseSheet = (index) => {
    setSheetIndex(index);
    setLayout(guessSheetLayout(workbook.sheets[index].rows));
    setCarry([]);
  };

  const sheet = workbook?.sheets[sheetIndex] ?? null;
  const parsed = useMemo(
    () =>
      sheet
        ? sheetEntries(sheet.rows, { ...layout, carry, firstRow: sheet.firstRow }, layout.headers)
        : null,
    [sheet, layout, carry]
  );

  /* --------------------------------------------------------------- results */

  const prefixList = useMemo(() => cleanPrefixes(prefixes), [prefixes]);
  const result = useMemo(
    () =>
      items.length > 0 && parsed && !reading
        ? reconcile(items, parsed.entries, { prefixes: prefixList })
        : null,
    [items, parsed, reading, prefixList]
  );

  const extraColumns = carry.map((column) => ({
    key: `extra-${column}`,
    label: layout.headers[column],
  }));
  const extrasOf = (row) =>
    Object.fromEntries(
      carry.map((column) => [`extra-${column}`, row.extras[layout.headers[column]] ?? ''])
    );

  const sections = useMemo(() => {
    if (!result) return null;
    return {
      onlyPdf: {
        columns: [
          { key: 'invoice', label: 'Invoice' },
          { key: 'file', label: 'File' },
          { key: 'found', label: 'Found by' },
          { key: 'notes', label: 'Notes' },
        ],
        rows: result.onlyPdf.map((entry) => ({
          id: entry.pdf.id,
          file: entry.pdf,
          flagged: entry.duplicate,
          cells: {
            invoice: entry.pdf.invoice,
            file: entry.pdf.path,
            found: FOUND_BY[entry.pdf.source] ?? '',
            notes: entry.notes.join('; '),
          },
        })),
      },
      onlySheet: {
        columns: [
          { key: 'invoice', label: 'Invoice' },
          { key: 'row', label: 'Row', numeric: true },
          ...extraColumns,
          { key: 'notes', label: 'Notes' },
        ],
        rows: result.onlySheet.map((entry) => ({
          id: `row-${entry.row.rowNumber}`,
          flagged: entry.duplicate,
          cells: {
            invoice: entry.row.invoice,
            row: entry.row.rowNumber,
            ...extrasOf(entry.row),
            notes: entry.notes.join('; '),
          },
        })),
      },
      matched: {
        columns: [
          { key: 'invoice', label: 'Invoice (PDF)' },
          { key: 'sheetInvoice', label: 'Invoice (sheet)' },
          { key: 'file', label: 'File' },
          { key: 'row', label: 'Row', numeric: true },
          ...extraColumns,
          { key: 'notes', label: 'Notes' },
        ],
        rows: result.matched.map((entry) => ({
          id: `match-${entry.pdf.id}`,
          file: entry.pdf,
          flagged: entry.duplicate || entry.cleanup,
          cells: {
            invoice: entry.pdf.invoice,
            sheetInvoice: entry.row.invoice,
            file: entry.pdf.path,
            row: entry.row.rowNumber,
            ...extrasOf(entry.row),
            notes: entry.notes.join('; '),
          },
        })),
      },
      unreadable: {
        columns: [
          { key: 'file', label: 'File' },
          { key: 'notes', label: 'Why' },
        ],
        rows: result.unreadable.map((item) => ({
          id: `unread-${item.id}`,
          file: item.problem ? null : item,
          flagged: true,
          cells: { file: item.path, notes: whyUnchecked(item) },
        })),
      },
    };
    // extraColumns and extrasOf follow carry and layout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, carry, layout]);

  const exportWorkbook = useCallback(async () => {
    if (!sections) return;
    const asRows = ({ columns, rows }) => [
      columns.map((column) => column.label),
      ...rows.map((row) => columns.map((column) => row.cells[column.key] ?? '')),
    ];
    const sheets = [
      { name: 'In PDFs, not in Excel', rows: asRows(sections.onlyPdf) },
      { name: 'In Excel, not in PDFs', rows: asRows(sections.onlySheet) },
      { name: 'Matched', rows: asRows(sections.matched) },
    ];
    if (sections.unreadable.rows.length) {
      sheets.push({ name: 'Could not check', rows: asRows(sections.unreadable) });
    }
    try {
      saveFile(await writeWorkbook(sheets), 'reconcile-results.xlsx');
      toast('Downloaded reconcile-results.xlsx.');
    } catch {
      toast('The results could not be written to Excel. Copy the sections instead.', {
        kind: 'error',
      });
    }
  }, [sections, toast]);

  const busy = Boolean(reading || scanReading);

  return (
    <div className="reconcile-tab">
      <div className="page-head reconcile-head">
        <div>
          <h2>Reconcile</h2>
          <p>Check a folder of invoice PDFs against a spreadsheet, both ways.</p>
        </div>
        <button
          type="button"
          className="button"
          onClick={exportWorkbook}
          disabled={!sections}
          data-testid="export-results"
        >
          Export results to Excel
        </button>
      </div>

      <div className="reconcile-inputs">
        <PdfInput
          items={items}
          reading={reading}
          scanReading={scanReading}
          onFiles={addPdfs}
          onCancel={() => {
            if (cancelRef.current) cancelRef.current.aborted = true;
          }}
          onClear={() => setItems([])}
          onReadScans={readScans}
        />
        <SheetInput
          workbook={workbook}
          sheetIndex={sheetIndex}
          layout={layout}
          carry={carry}
          parsed={parsed}
          error={sheetError}
          onFiles={loadSheet}
          onSheet={chooseSheet}
          onColumn={(column) => {
            setLayout((current) => ({ ...current, invoiceColumn: column }));
            setCarry((current) => current.filter((entry) => entry !== column));
          }}
          onCarry={(column, on) =>
            setCarry((current) =>
              on
                ? [...current, column].sort((a, b) => a - b)
                : current.filter((entry) => entry !== column)
            )
          }
          onClear={() => {
            setWorkbook(null);
            setSheetError('');
            setCarry([]);
          }}
        />
      </div>

      {sections ? (
        <div className="reconcile-results" data-testid="reconcile-results">
          {(result.duplicates.pdf > 0 || result.duplicates.sheet > 0) && (
            <p className="duplicate-note" data-testid="duplicate-note">
              Duplicates:{' '}
              {[
                result.duplicates.pdf && `${result.duplicates.pdf} PDFs share a number`,
                result.duplicates.sheet && `${result.duplicates.sheet} sheet rows share a number`,
              ]
                .filter(Boolean)
                .join(', ')}
              . They are marked in the sections below.
            </p>
          )}
          <ResultSection
            id="only-pdf"
            title="In PDFs, not in Excel"
            hint="Invoices you have a file for that are not on the sheet."
            {...sections.onlyPdf}
            onOpen={(row) => setPreview(row.file)}
            emptyText="Every PDF is on the sheet."
          />
          <ResultSection
            id="only-sheet"
            title="In Excel, not in PDFs"
            hint="Invoices on the sheet that you have no file for."
            {...sections.onlySheet}
            emptyText="Every invoice on the sheet has a PDF."
          />
          <ResultSection
            id="matched"
            title="Matched"
            {...sections.matched}
            defaultOpen={false}
            onOpen={(row) => setPreview(row.file)}
            emptyText="Nothing matched yet."
          />
          {sections.unreadable.rows.length > 0 && (
            <ResultSection
              id="unchecked"
              title="Could not check"
              hint="Files with no invoice number found, so they are on neither side."
              {...sections.unreadable}
              onOpen={(row) => setPreview(row.file)}
              emptyText=""
            />
          )}
        </div>
      ) : (
        !busy && (
          <EmptyState icon="compare" title="Results appear here" testId="reconcile-empty">
            <p>
              {items.length === 0 && !workbook
                ? 'Add invoice PDFs on the left and a spreadsheet on the right.'
                : items.length === 0
                  ? 'Now add the invoice PDFs on the left.'
                  : 'Now add the spreadsheet on the right.'}
            </p>
          </EmptyState>
        )
      )}

      {preview && <PdfPreview item={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}
