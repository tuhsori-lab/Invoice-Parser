import { tallyRows } from '../../core/tally.js';

/**
 * How each client's invoices have gone, in this browser: how many went out
 * accepted as read, how many a person corrected, and how many went out with
 * something still flagged. A client whose invoices keep needing a look stands
 * out, and their box may want drawing again.
 */
export default function ClientTally({ tally, onClear }) {
  const rows = tallyRows(tally);
  return (
    <section className="field-group client-tally" data-testid="client-tally">
      <h3 className="legend-like">How each client has gone</h3>
      {rows.length === 0 ? (
        <p className="field-value muted" data-testid="tally-empty">
          Nothing yet. Invoices are counted here as they are saved.
        </p>
      ) : (
        <>
          <ul className="tally-list">
            {rows.map((row) => (
              <li key={row.key} data-testid={`tally-row-${row.key}`}>
                <span className="tally-name">{row.name}</span>
                <span className="tally-counts">
                  <span data-testid="tally-accepted">{row.accepted} accepted</span>
                  {' \u00b7 '}
                  <span data-testid="tally-corrected">{row.corrected} corrected</span>
                  {' \u00b7 '}
                  <span data-testid="tally-review">{row.review} sent to review</span>
                </span>
              </li>
            ))}
          </ul>
          <button type="button" className="link-button" data-testid="tally-clear" onClick={onClear}>
            Clear these counts
          </button>
        </>
      )}
      <small>
        Kept only in this browser. Only the counts are kept - never an invoice number or a file.
      </small>
    </section>
  );
}
