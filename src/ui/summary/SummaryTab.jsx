import { useCallback, useMemo, useState } from 'react';
import { reconcile } from '../../core/reconcile/match.js';
import { cleanPrefixes } from '../../core/reconcile/normalize.js';
import {
  SUMMARY_ORDER,
  SUMMARY_STATUS,
  summarize,
  totalsByCurrency,
  totalsByCustomer,
} from '../../core/summary.js';
import { writeWorkbook } from '../../lib/sheets.js';
import { saveFile } from '../../lib/download.js';
import EmptyState from '../common/EmptyState.jsx';
import { useToast } from '../common/Toasts.jsx';
import ResultSection from '../reconcile/ResultSection.jsx';
import PdfPreview from '../reconcile/PdfPreview.jsx';
import { DueChart, StatusDonut } from './Charts.jsx';

/** An amount in its own currency, or a plain number when the currency is unknown. */
function money(amount, currency) {
  if (amount === null || amount === undefined) return '';
  return currency
    ? new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount)
    : amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** A date nobody in the US or Europe can misread: "2 Sep 2026". */
function day(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** How late, or how soon, in words. */
function when(row) {
  if (row.status === 'paid') return SUMMARY_STATUS.paid;
  if (row.daysLeft === null) return SUMMARY_STATUS.unknown;
  if (row.daysLeft < 0) return `Past due ${-row.daysLeft} ${row.daysLeft === -1 ? 'day' : 'days'}`;
  if (row.daysLeft === 0) return 'Due today';
  return `Due in ${row.daysLeft} ${row.daysLeft === 1 ? 'day' : 'days'}`;
}

/** Today in this computer's own time zone, as YYYY-MM-DD. */
const todayIso = () => new Date().toLocaleDateString('en-CA');

const dateRank = (iso) => (iso ? Date.parse(iso) : 0);

/**
 * The Summary tab: what every invoice sent is worth and when it is due, from the
 * PDFs and the spreadsheet already loaded on the Reconcile tab.
 */
export default function SummaryTab({ data, prefixes }) {
  const toast = useToast();
  const [show, setShow] = useState('all');
  const [preview, setPreview] = useState(null);

  const rows = useMemo(() => {
    if (!data || (data.items.length === 0 && data.entries.length === 0)) return null;
    const result = reconcile(data.items, data.entries, { prefixes: cleanPrefixes(prefixes) });
    return summarize(result, { today: todayIso() });
  }, [data, prefixes]);

  const currencies = useMemo(() => (rows ? totalsByCurrency(rows) : []), [rows]);
  const customers = useMemo(() => (rows ? totalsByCustomer(rows) : []), [rows]);

  const table = useMemo(() => {
    if (!rows) return null;
    return {
      columns: [
        {
          key: 'status',
          label: 'Status',
          rank: (row) => SUMMARY_ORDER.indexOf(row.status) * 100_000 + (row.daysLeft ?? 0),
          render: (row) => (
            <span className={`status status-${row.status}`}>{row.cells.status}</span>
          ),
        },
        { key: 'invoice', label: 'Invoice' },
        { key: 'customer', label: 'Customer' },
        { key: 'date', label: 'Invoice date', rank: (row) => dateRank(row.dateIso) },
        { key: 'terms', label: 'Terms' },
        { key: 'due', label: 'Due date', rank: (row) => dateRank(row.dueIso) },
        { key: 'total', label: 'Total', numeric: true, rank: (row) => row.total ?? 0 },
        { key: 'notes', label: 'Notes' },
      ],
      rows: rows.map((row) => ({
        ...row,
        file: row.pdf,
        flagged: row.notes.length > 0,
        cells: {
          status: when(row),
          invoice: row.invoice,
          customer: row.customer ?? '',
          date: day(row.dateIso),
          terms: row.terms,
          due: day(row.dueIso),
          total: money(row.total, row.currency),
          notes: row.notes.join('; '),
        },
      })),
    };
  }, [rows]);

  const customerTable = useMemo(
    () => ({
      columns: [
        { key: 'customer', label: 'Customer' },
        { key: 'open', label: 'Open invoices', numeric: true },
        {
          key: 'outstanding',
          label: 'Outstanding',
          numeric: true,
          rank: (row) => row.outstanding,
        },
        { key: 'overdue', label: 'Past due', numeric: true, rank: (row) => row.overdue },
        { key: 'late', label: 'Most days late', numeric: true },
      ],
      rows: customers.map((sum) => ({
        ...sum,
        id: `${sum.customer}|${sum.currency}`,
        cells: {
          customer: sum.customer,
          open: sum.open,
          outstanding: money(sum.outstanding, sum.currency),
          overdue: sum.overdue ? money(sum.overdue, sum.currency) : '',
          late: sum.mostLate || '',
        },
      })),
    }),
    [customers]
  );

  const exportWorkbook = useCallback(async () => {
    if (!rows) return;
    const sheets = [
      {
        name: 'Invoices',
        rows: [
          [
            'Status',
            'Invoice',
            'Customer',
            'Invoice date',
            'Terms',
            'Due date',
            'Days left',
            'Currency',
            'Total',
            'Notes',
          ],
          ...rows.map((row) => [
            SUMMARY_STATUS[row.status],
            row.invoice,
            row.customer ?? '',
            row.dateIso ?? '',
            row.terms,
            row.dueIso ?? '',
            row.daysLeft ?? '',
            row.currency ?? '',
            row.total ?? '',
            row.notes.join('; '),
          ]),
        ],
      },
      {
        name: 'Customers',
        rows: [
          ['Customer', 'Currency', 'Open invoices', 'Outstanding', 'Past due', 'Most days late'],
          ...customers.map((sum) => [
            sum.customer,
            sum.currency ?? '',
            sum.open,
            sum.outstanding,
            sum.overdue,
            sum.mostLate,
          ]),
        ],
      },
    ];
    try {
      saveFile(await writeWorkbook(sheets), 'invoice-summary.xlsx');
      toast('Downloaded invoice-summary.xlsx.');
    } catch {
      toast('The summary could not be written to Excel. Copy the table instead.', {
        kind: 'error',
      });
    }
  }, [rows, customers, toast]);

  return (
    <div className="summary-tab">
      <div className="page-head reconcile-head">
        <div>
          <h2>Summary</h2>
          <p>What every invoice is worth and when it is due, from the files on Reconcile.</p>
        </div>
        <button
          type="button"
          className="button"
          onClick={exportWorkbook}
          disabled={!rows}
          data-testid="export-summary"
        >
          Export summary to Excel
        </button>
      </div>

      {!table ? (
        <EmptyState icon="compare" title="Nothing to sum up yet" testId="summary-empty">
          <p>Add your invoice PDFs, and your spreadsheet if you have one, on the Reconcile tab.</p>
        </EmptyState>
      ) : (
        <>
          <div className="stat-cards" data-testid="summary-totals">
            {currencies.map((sum) => (
              <section className="stat-card" key={sum.currency ?? 'none'}>
                <h3>{sum.currency ?? 'Unknown currency'}</h3>
                <div className="stat-card-body">
                  <StatusDonut
                    sum={sum}
                    money={(amount) => money(amount, sum.currency)}
                    active={show}
                    onPick={setShow}
                  />
                  <DueChart buckets={sum.buckets} money={(amount) => money(amount, sum.currency)} />
                </div>
              </section>
            ))}
          </div>

          <div className="reconcile-results">
            <ResultSection
              id="summary"
              title="Invoices"
              toolbar={
                <div
                  className="segmented"
                  role="group"
                  aria-label="Show"
                  data-testid="summary-filter"
                >
                  {['all', ...SUMMARY_ORDER].map((key) => {
                    const count =
                      key === 'all'
                        ? table.rows.length
                        : table.rows.filter((row) => row.status === key).length;
                    if (key !== 'all' && count === 0) return null;
                    return (
                      <button
                        key={key}
                        type="button"
                        aria-pressed={show === key}
                        onClick={() => setShow(key)}
                        data-testid={`summary-show-${key}`}
                      >
                        {key !== 'all' && <span className={`status-dot status-${key}`} />}
                        {key === 'all' ? 'All' : SUMMARY_STATUS[key]}
                        <span className="segment-count">{count}</span>
                      </button>
                    );
                  })}
                </div>
              }
              columns={table.columns}
              rows={show === 'all' ? table.rows : table.rows.filter((row) => row.status === show)}
              onOpen={(row) => setPreview(row.file)}
              emptyText="Nothing here."
            />
            <ResultSection
              id="customers"
              title="By customer"
              hint="What each customer still owes, most past due first."
              {...customerTable}
              initialSort={{ key: 'overdue', down: true }}
              emptyText="Everything is paid."
            />
          </div>
        </>
      )}

      {preview && <PdfPreview item={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}
