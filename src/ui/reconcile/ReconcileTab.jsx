import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { explain } from '../../core/errors.js';
import { FLAG_LABELS } from '../../core/group.js';
import { cleanPrefixes, matchKey } from '../../core/reconcile/normalize.js';
import { reconcile } from '../../core/reconcile/match.js';
import { compareWithSheet, formatMoney } from '../../core/reconcile/compare.js';
import { guessFieldColumns, guessSheetLayout, sheetEntries } from '../../core/reconcile/sheet.js';
import { readInvoicePdfs, readScannedPdfs } from '../../lib/readInvoicePdfs.js';
import { isSheetFile, readWorkbook, SheetFileError, writeWorkbook } from '../../lib/sheets.js';
import { saveFile } from '../../lib/download.js';
import { isPdfFile } from '../../lib/droppedFiles.js';
import { loadSamples, SAMPLE_PDFS, SAMPLE_SHEET } from '../../lib/samples.js';
import EmptyState from '../common/EmptyState.jsx';
import { useToast } from '../common/Toasts.jsx';
import PdfInput from './PdfInput.jsx';
import SheetInput from './SheetInput.jsx';
import ResultSection from './ResultSection.jsx';
import PdfPreview from './PdfPreview.jsx';
import { useHiddenColumns } from '../../lib/useHiddenColumns.js';
import { parseMoney, readFields } from '../../core/fields.js';
import {
  describePattern,
  learnLabel,
  withLabel,
  withPatternPo,
  withPoPattern,
  withoutPoPattern,
} from '../../core/learn.js';
import { loadLearned, NOTHING_LEARNED, saveLearned } from '../../lib/learnedLabels.js';
import AddValue from './AddValue.jsx';
import { downloadInvoicePdf } from '../../lib/invoicePdf.js';

/** Where a PDF's number came from, in words. */
const FOUND_BY = { text: 'PDF text', scan: 'Scan', filename: 'File name' };

/** Each row's status, in the order they sort: problems ahead of matches. */
const STATUS = {
  priceDiffers: 'Price differs',
  poDiffers: 'PO differs',
  onlySheet: 'Missing PDF',
  onlyPdf: 'Not in Excel',
  unreadable: 'No number found',
  matched: 'Matched',
};
const STATUS_ORDER = Object.keys(STATUS);

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
export default function ReconcileTab({ prefixes, onData }) {
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
  const [show, setShow] = useState('all');
  const [hiddenColumns, setHiddenColumns] = useHiddenColumns('results');
  // Labels taught by typing in a missing PO or amount, and what was typed.
  const [learned, setLearned] = useState(loadLearned);
  const [typed, setTyped] = useState({});

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
      const seen = new Set(items.map((item) => `${item.sourcePath}|${item.file.size}`));
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
        current.flatMap((item) => (found.has(item.fileId) ? found.get(item.fileId) : [item]))
      );
      toast(
        `Found invoices in ${found.size} of ${scans.length} scanned ${scans.length === 1 ? 'file' : 'files'}.`,
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

  /**
   * The invoices as read, with any labels taught since read again, and anything
   * typed in on top: what a person typed is what they meant.
   */
  const prefixList = useMemo(() => cleanPrefixes(prefixes), [prefixes]);

  // Whose invoice each is, from the spreadsheet's customer column, for invoices
  // whose PDF names no customer.
  const sheetCustomers = useMemo(() => {
    const found = new Map();
    for (const entry of parsed?.entries ?? []) {
      const key = matchKey(entry.invoice, { prefixes: prefixList });
      if (key && entry.fields?.customer && !found.has(key)) found.set(key, entry.fields.customer);
    }
    return found;
  }, [parsed, prefixList]);
  const customerOf = useCallback(
    (item) =>
      item.fields?.customer ??
      (item.invoice
        ? sheetCustomers.get(matchKey(item.invoice, { prefixes: prefixList }))
        : null) ??
      null,
    [sheetCustomers, prefixList]
  );

  const itemsRead = useMemo(() => {
    const taught = learned.po.length > 0 || learned.total.length > 0;
    return items.map((item) => {
      let fields = taught && item.readable ? readFields(item.readable, learned) : item.fields;
      // No label gave a PO: look for one shaped like this customer's POs.
      fields = withPatternPo(fields, item.readable, learned, item.invoice, customerOf(item));
      const own = typed[item.id];
      if (own?.po) fields = { ...fields, po: { value: own.po, raw: own.po, typed: true } };
      if (own?.total) {
        const money =
          parseMoney(own.total) ?? parseMoney(`${own.total} ${fields?.total?.currency ?? ''}`);
        if (money) fields = { ...fields, total: { ...money, raw: own.total, typed: true } };
      }
      return fields === item.fields ? item : { ...item, fields };
    });
  }, [items, learned, typed, customerOf]);

  /**
   * A value typed in for one invoice: kept for it, and what it teaches used for
   * the rest - the label it is printed after, and for a PO, the shape of that
   * customer's POs.
   */
  const addValue = useCallback(
    (item, field, value) => {
      const before = typed[item.id]?.[field];
      setTyped((current) => ({ ...current, [item.id]: { ...current[item.id], [field]: value } }));
      const what = field === 'po' ? 'PO' : 'amount';
      // The PDF's "Bill to", or the spreadsheet's customer when the PDF names none.
      const customer = customerOf(item);
      const label = item.readable ? learnLabel(item.readable, field, value, [customer]) : null;
      // A typed PO corrected: what its first spelling taught goes.
      let base = learned;
      if (field === 'po' && customer && before) base = withoutPoPattern(base, customer, before);
      let next = label ? withLabel(base, field, label) : base;
      if (field === 'po' && customer) next = withPoPattern(next, customer, value);
      if (next === base) {
        // Nothing new to learn; any shape a mistyped PO taught is gone all the same.
        if (base !== learned) {
          setLearned(base);
          saveLearned(base);
        }
        const shape = field === 'po' && customer ? poPatternFor(base, customer) : '';
        toast(
          shape
            ? `Saved for this invoice. ${customer}\u2019s POs were already known to look like ${shape}.`
            : field === 'po'
              ? 'Saved for this invoice. Its PO has no label beside it, and no customer was found on the invoice or in Excel, so there was nothing to learn.'
              : 'Saved for this invoice. The amount was not printed beside a label on its PDF, so there was nothing to learn.',
          { kind: 'info' }
        );
        return;
      }
      // How many other invoices this fills in, read as they will be from now on.
      const has = (other, taught) =>
        withPatternPo(
          other.readable ? readFields(other.readable, taught) : other.fields,
          other.readable,
          taught,
          other.invoice,
          customerOf(other)
        )?.[field];
      const filled = items.filter(
        (other) =>
          other.id !== item.id && other.readable && !has(other, learned) && has(other, next)
      ).length;
      setLearned(next);
      saveLearned(next);
      const shape = poPatternFor(next, customer);
      const how = label
        ? `the ${what} follows \u201c${label}\u201d`
        : `${customer}\u2019s POs look like ${shape}`;
      toast(
        `Learned: ${how}. ${
          filled === 0
            ? 'No other invoice here can be filled from it yet; the next batch will be read with it.'
            : `Filled it in for ${filled === 1 ? '1 more invoice' : `${filled} more invoices`}.`
        }`,
        { kind: 'success' }
      );
    },
    [items, learned, toast, typed, customerOf]
  );

  /** One invoice as its own PDF, named by its number. */
  const downloadOne = useCallback(
    async (item) => {
      try {
        toast(`Downloaded ${await downloadInvoicePdf(item)}.`);
      } catch {
        toast('This invoice could not be saved as its own PDF.', { kind: 'error' });
      }
    },
    [toast]
  );

  const forgetLearned = () => {
    setLearned(NOTHING_LEARNED);
    saveLearned(NOTHING_LEARNED);
    toast('Forgot what it learned.');
  };

  // The Summary tab works from the same files.
  useEffect(() => {
    onData?.({ items: itemsRead, entries: parsed?.entries ?? [] });
  }, [itemsRead, parsed, onData]);

  /* --------------------------------------------------------------- results */

  const result = useMemo(
    () =>
      itemsRead.length > 0 && parsed && !reading
        ? reconcile(itemsRead, parsed.entries, { prefixes: prefixList })
        : null,
    [itemsRead, parsed, reading, prefixList]
  );

  // Amount and PO already have their own columns; never show them twice.
  const fieldColumns = guessFieldColumns(layout.headers, layout.invoiceColumn);
  const shownCarry = carry.filter(
    (column) => column !== fieldColumns.amount && column !== fieldColumns.po
  );
  const extraColumns = shownCarry.map((column) => ({
    key: `extra-${column}`,
    label: layout.headers[column],
  }));
  const extrasOf = (row) =>
    Object.fromEntries(
      shownCarry.map((column) => [`extra-${column}`, row.extras[layout.headers[column]] ?? ''])
    );

  /** Everything in one table: each invoice once, with whether it checked out. */
  const table = useMemo(() => {
    if (!result) return null;
    const pdfNotes = (pdf, notes) =>
      [...(pdf.flags ?? []).map((flag) => FLAG_LABELS[flag] ?? flag), ...notes].join('; ');
    const rows = [
      ...result.onlySheet.map((entry) => ({
        id: `row-${entry.row.rowNumber}`,
        status: 'onlySheet',
        flagged: entry.duplicate,
        cells: {
          status: STATUS.onlySheet,
          sheetInvoice: entry.row.invoice,
          row: entry.row.rowNumber,
          ...extrasOf(entry.row),
          notes: entry.notes.join('; '),
        },
      })),
      ...result.onlyPdf.map((entry) => ({
        id: entry.pdf.id,
        status: 'onlyPdf',
        file: entry.pdf,
        flagged: entry.duplicate,
        cells: {
          status: STATUS.onlyPdf,
          invoice: entry.pdf.invoice,
          file: entry.pdf.path,
          found: FOUND_BY[entry.pdf.source] ?? '',
          notes: pdfNotes(entry.pdf, entry.notes),
        },
      })),
      ...result.unreadable.map((item) => ({
        id: `unread-${item.id}`,
        status: 'unreadable',
        file: item.problem ? null : item,
        cells: { status: STATUS.unreadable, file: item.path, notes: whyUnchecked(item) },
      })),
      ...result.matched.map((entry) => {
        // Matched by number: now do the amount and the PO agree with Excel?
        const check = compareWithSheet(entry.pdf.fields, entry.row.fields);
        const status = check.priceDiffers
          ? 'priceDiffers'
          : check.poDiffers
            ? 'poDiffers'
            : 'matched';
        const { currency } = check.amount;
        return {
          id: `match-${entry.pdf.id}`,
          status,
          file: entry.pdf,
          flagged: entry.duplicate || entry.cleanup,
          // A price that disagrees with Excel is the one thing that must not be missed.
          alert: check.priceDiffers,
          cells: {
            status: STATUS[status],
            invoice: entry.pdf.invoice,
            sheetInvoice: entry.row.invoice,
            file: entry.pdf.path,
            found: FOUND_BY[entry.pdf.source] ?? '',
            row: entry.row.rowNumber,
            pdfAmount: formatMoney(check.amount.pdf, currency),
            sheetAmount: formatMoney(check.amount.sheet, currency),
            difference:
              check.amount.difference === null
                ? ''
                : `${check.amount.difference > 0 ? '+' : '−'}${formatMoney(Math.abs(check.amount.difference), currency)}`,
            pdfPo: check.po.pdf ?? '',
            // How the PDF's own values were got, when not by the usual labels.
            pdfAmountFrom: fromWhere(entry.pdf.fields?.total),
            pdfAmountRaw: entry.pdf.fields?.total?.raw ?? '',
            pdfPoFrom: fromWhere(entry.pdf.fields?.po),
            sheetPo: check.po.sheet ?? '',
            ...extrasOf(entry.row),
            notes: pdfNotes(entry.pdf, [...check.notes, ...entry.notes]),
          },
        };
      }),
    ];
    // Amount and PO columns only when the files or the sheet have them.
    const has = (key) => rows.some((row) => row.cells[key]);
    return {
      columns: [
        {
          key: 'status',
          label: 'Status',
          rank: (row) => STATUS_ORDER.indexOf(row.status),
          render: (row) => (
            <span className={`status status-${row.status}`}>{row.cells.status}</span>
          ),
        },
        { key: 'invoice', label: 'Invoice (PDF)' },
        { key: 'sheetInvoice', label: 'Invoice (sheet)' },
        ...(has('pdfAmount') || has('sheetAmount')
          ? [
              {
                key: 'pdfAmount',
                label: 'Amount (PDF)',
                render: (row) => (
                  <PdfValue row={row} field="total" onAdd={addValue}>
                    <span className="amount">{row.cells.pdfAmount}</span>
                  </PdfValue>
                ),
              },
              {
                key: 'sheetAmount',
                label: 'Amount (Excel)',
                render: (row) => <span className="amount">{row.cells.sheetAmount}</span>,
              },
              {
                key: 'difference',
                label: 'Difference',
                render: (row) =>
                  row.cells.difference ? (
                    <strong className="difference">{row.cells.difference}</strong>
                  ) : (
                    ''
                  ),
              },
            ]
          : []),
        ...(has('pdfPo') || has('sheetPo')
          ? [
              {
                key: 'pdfPo',
                label: 'PO (PDF)',
                render: (row) => (
                  <PdfValue row={row} field="po" onAdd={addValue}>
                    {row.cells.pdfPo}
                  </PdfValue>
                ),
              },
              { key: 'sheetPo', label: 'PO (Excel)' },
            ]
          : []),
        { key: 'file', label: 'File' },
        { key: 'found', label: 'Found by' },
        { key: 'row', label: 'Row', numeric: true },
        ...extraColumns,
        { key: 'notes', label: 'Notes', note: true },
        {
          key: 'actions',
          label: 'Preview and download',
          action: true,
          render: (row) =>
            row.file ? (
              <span className="row-actions">
                <button
                  type="button"
                  className="link-button"
                  onClick={(event) => {
                    event.stopPropagation();
                    setPreview(row.file);
                  }}
                  data-testid={`preview-${row.id}`}
                >
                  Preview
                </button>
                <button
                  type="button"
                  className="link-button"
                  onClick={(event) => {
                    event.stopPropagation();
                    downloadOne(row.file);
                  }}
                  data-testid={`download-${row.id}`}
                >
                  Download
                </button>
              </span>
            ) : null,
        },
      ],
      rows,
    };
    // extraColumns and extrasOf follow carry and layout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, carry, layout, addValue, downloadOne]);

  const exportWorkbook = useCallback(async () => {
    if (!table) return;
    // The columns on screen, so a hidden column stays out of the file too; buttons never go in.
    const columns = table.columns.filter(
      (column) => !column.action && !hiddenColumns.includes(column.key)
    );
    const rows = [
      columns.map((column) => column.label),
      ...table.rows.map((row) => columns.map((column) => row.cells[column.key] ?? '')),
    ];
    try {
      saveFile(await writeWorkbook([{ name: 'Reconcile', rows }]), 'reconcile-results.xlsx');
      toast('Downloaded reconcile-results.xlsx.');
    } catch {
      toast('The results could not be written to Excel. Copy the table instead.', {
        kind: 'error',
      });
    }
  }, [table, toast, hiddenColumns]);

  const busy = Boolean(reading || scanReading);
  const priceCount = table?.rows.filter((row) => row.status === 'priceDiffers').length ?? 0;
  const poCount = table?.rows.filter((row) => row.status === 'poDiffers').length ?? 0;

  /** The sample PDFs and their spreadsheet, to see every part of Reconcile and Summary. */
  const trySamples = async () => {
    try {
      const [pdfs, sheet] = await Promise.all([
        loadSamples(SAMPLE_PDFS),
        loadSamples([SAMPLE_SHEET]),
      ]);
      await loadSheet(sheet);
      await addPdfs(pdfs);
    } catch (error) {
      toast(error.message, { kind: 'error' });
    }
  };

  return (
    <div className="reconcile-tab">
      <div className="page-head reconcile-head">
        <div>
          <h2>Reconcile</h2>
          <p>Split invoice PDFs and check every invoice against a spreadsheet, both ways.</p>
        </div>
        <button
          type="button"
          className="button"
          onClick={exportWorkbook}
          disabled={!table}
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

      {table ? (
        <div className="reconcile-results" data-testid="reconcile-results">
          {(learned.po.length > 0 ||
            learned.total.length > 0 ||
            Object.keys(learned.poPatterns).length > 0) && (
            <p className="learned-note" data-testid="learned-note">
              <span>
                Learned:{' '}
                {[
                  ...learned.po.map((label) => `PO after \u201c${label}\u201d`),
                  ...learned.total.map((label) => `amount after \u201c${label}\u201d`),
                  ...Object.values(learned.poPatterns).map(
                    ({ name, patterns }) =>
                      `${name} POs like ${patterns.map(describePattern).join(' or ')}`
                  ),
                ].join(' \u00b7 ')}
              </span>
              <button type="button" className="link-button" onClick={forgetLearned}>
                Forget
              </button>
            </p>
          )}
          <ResultSection
            id="results"
            title="Results"
            toolbar={
              <div className="segmented" role="group" aria-label="Show" data-testid="status-filter">
                {['all', ...STATUS_ORDER].map((key) => {
                  const count =
                    key === 'all'
                      ? table.rows.length
                      : table.rows.filter((row) => row.status === key).length;
                  // The two checks against Excel's values show only when something differs.
                  if (!count && (key === 'priceDiffers' || key === 'poDiffers') && show !== key) {
                    return null;
                  }
                  return (
                    <button
                      key={key}
                      type="button"
                      aria-pressed={show === key}
                      onClick={() => setShow(key)}
                      data-testid={`show-${key}`}
                    >
                      {key !== 'all' && <span className={`status-dot status-${key}`} />}
                      {key === 'all' ? 'All' : STATUS[key]}
                      <span className="segment-count">{count}</span>
                    </button>
                  );
                })}
              </div>
            }
            hint={[
              priceCount > 0 &&
                `${priceCount === 1 ? '1 invoice has' : `${priceCount} invoices have`} a different amount in Excel`,
              poCount > 0 &&
                `${poCount === 1 ? '1 invoice has' : `${poCount} invoices have`} a different PO in Excel`,
              result.duplicates.pdf && `${result.duplicates.pdf} PDF invoices share a number`,
              result.duplicates.sheet && `${result.duplicates.sheet} sheet rows share a number`,
            ]
              .filter(Boolean)
              .join(' · ')}
            columns={table.columns}
            rows={show === 'all' ? table.rows : table.rows.filter((row) => row.status === show)}
            onOpen={(row) => setPreview(row.file)}
            emptyText="Nothing here."
            hiddenColumns={hiddenColumns}
            onHiddenColumns={setHiddenColumns}
          />
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
            {items.length === 0 && !workbook && (
              <button
                type="button"
                className="button quiet"
                onClick={trySamples}
                data-testid="try-samples-reconcile"
              >
                Try it with sample files
              </button>
            )}
          </EmptyState>
        )
      )}

      {preview && <PdfPreview item={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}

/** "typed" or the label taught, for a value not found by the usual labels. */
function fromWhere(found) {
  if (found?.typed) return 'typed';
  if (found?.pattern) return `pattern:${found.pattern}`;
  return found?.learned ? `learned:${found.learned}` : '';
}

/** The shape last learned for a customer's POs, as a person reads it. */
function poPatternFor(learned, customer) {
  const known = Object.values(learned.poPatterns ?? {}).find((entry) => entry.name === customer);
  return known ? describePattern(known.patterns.at(-1)) : '';
}

/**
 * A value read from the PDF, marked when it was typed or found by a taught
 * label; or, when none was found on a matched invoice, a way to type it in.
 */
function PdfValue({ row, field, onAdd, children }) {
  const value = field === 'po' ? row.cells.pdfPo : row.cells.pdfAmount;
  const from = field === 'po' ? row.cells.pdfPoFrom : row.cells.pdfAmountFrom;
  if (!value) {
    return row.file && row.status !== 'onlySheet' && row.status !== 'unreadable' ? (
      <AddValue
        label={field === 'po' ? 'PO' : 'amount'}
        onSave={(typed) => onAdd(row.file, field, typed)}
        testId={`add-${field}-${row.cells.invoice}`}
      />
    ) : null;
  }
  const edit = row.file ? (
    <AddValue
      label={field === 'po' ? 'PO' : 'amount'}
      initial={field === 'po' ? value : row.cells.pdfAmountRaw || value}
      onSave={(typed) => onAdd(row.file, field, typed)}
      testId={`edit-${field}-${row.cells.invoice}`}
    />
  ) : null;
  if (!from) {
    return (
      <span className="value-from">
        {children}
        {edit}
      </span>
    );
  }
  const kind = from.split(':')[0];
  const detail = from.slice(from.indexOf(':') + 1);
  const tags = {
    typed: ['typed', 'Typed in by you'],
    learned: ['learned', `Read after \u201c${detail}\u201d, the label you taught it`],
    pattern: ['pattern', `The one value on it shaped like ${detail}\u2019s POs`],
  };
  const [tag, title] = tags[kind];
  return (
    <span className="value-from">
      {children}
      <span className="value-tag" title={title}>
        {tag}
      </span>
      {edit}
    </span>
  );
}
