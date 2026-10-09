import { useMemo, useState } from 'react';
import { REPORT_KINDS, buildReport, countReport } from '../../core/report.js';

/**
 * What is missing, pulled out into a spreadsheet: invoices in your list but not
 * in this batch, invoices here but not in your list, pages with no number, and
 * POs not found or not the ones your list has. Tick what you want, and save it.
 */
export default function MissingReport({ groups, knownList, missing, onSave }) {
  const rows = useMemo(
    () => buildReport(groups, { knownList, missing }),
    [groups, knownList, missing]
  );
  const counts = countReport(rows);
  const [left, setLeft] = useState(() => new Set());

  if (groups.length === 0) return null;

  // Why a kind cannot be chosen, when it cannot.
  const unavailable = (kind) => {
    if (kind.needsList && !knownList) return 'load your invoice list to see this';
    if (kind.needsPo && !knownList?.hasPo) return 'your invoice list has no PO column';
    return '';
  };
  const chosen = REPORT_KINDS.filter((kind) => !unavailable(kind) && !left.has(kind.key));
  const picked = rows.filter((row) => chosen.some((kind) => kind.key === row.kind));

  const toggle = (key) =>
    setLeft((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <section
      className="missing-report"
      aria-labelledby="missing-heading"
      data-testid="missing-report"
    >
      <h2 id="missing-heading">What&rsquo;s missing</h2>
      <p className="muted">
        Choose what to put in the file. It opens in Excel, one row for each thing to chase.
      </p>
      <ul className="missing-kinds">
        {REPORT_KINDS.map((kind) => {
          const why = unavailable(kind);
          return (
            <li key={kind.key}>
              <label className={`choice${why ? ' unavailable' : ''}`}>
                <input
                  type="checkbox"
                  checked={!why && !left.has(kind.key)}
                  disabled={Boolean(why)}
                  onChange={() => toggle(kind.key)}
                  data-testid={`report-${kind.key}`}
                />
                <span>
                  {kind.label}
                  {why ? (
                    <small>{why[0].toUpperCase() + why.slice(1)}.</small>
                  ) : (
                    <small data-testid={`report-count-${kind.key}`}>
                      {counts[kind.key] === 0
                        ? 'None'
                        : `${counts[kind.key]} ${counts[kind.key] === 1 ? 'row' : 'rows'}`}
                    </small>
                  )}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        className="button"
        onClick={() => onSave(picked)}
        disabled={chosen.length === 0}
        data-testid="report-download"
      >
        Download as a spreadsheet (CSV)
      </button>
      {chosen.length > 0 && picked.length === 0 && (
        <p className="muted" data-testid="report-nothing">
          Nothing missing in what you chose - the file will only have its headings.
        </p>
      )}
    </section>
  );
}
