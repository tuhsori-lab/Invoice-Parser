import { useRef, useState } from 'react';

/** How many expected-but-missing numbers to show before saying "and N more". */
const MISSING_SHOWN = 200;

/**
 * Checking the batch against the person's own list of invoice numbers.
 *
 * Three states: nothing loaded (an offer to load one), a file loaded but its
 * columns not yet chosen, and a list in use - with what it found, the strict
 * setting, and the invoices it expected but the batch does not have.
 */
export default function KnownList({
  list,
  pending,
  error,
  strict,
  verified,
  total,
  missing,
  onFile,
  onChoose,
  onCancel,
  onChangeColumns,
  onRemove,
  onStrict,
}) {
  const input = useRef(null);

  const picker = (
    <input
      ref={input}
      type="file"
      accept=".csv,.txt,.xlsx,.xls"
      className="visually-hidden"
      aria-label="Invoice list file (CSV or Excel)"
      data-testid="list-input"
      tabIndex={-1}
      onChange={(event) => {
        const [file] = event.target.files ?? [];
        event.target.value = '';
        if (file) onFile(file);
      }}
    />
  );

  if (pending) {
    return (
      <section className="known-list" aria-label="Your invoice list" data-testid="known-list">
        <ColumnChoice pending={pending} onChoose={onChoose} onCancel={onCancel} />
      </section>
    );
  }

  if (!list) {
    return (
      <section className="known-list" aria-label="Your invoice list" data-testid="known-list">
        <p>
          <strong>Check the numbers against your invoice list.</strong> Load a CSV or Excel file of
          your open invoices, exported from your accounting system. It is read on this computer and
          not kept.
        </p>
        {error && (
          <p className="problem" role="alert" data-testid="list-error">
            {error}
          </p>
        )}
        <button type="button" className="button quiet" onClick={() => input.current?.click()}>
          Load invoice list
        </button>
        {picker}
      </section>
    );
  }

  return (
    <section className="known-list" aria-label="Your invoice list" data-testid="known-list">
      <p data-testid="list-summary">
        <strong>
          {list.entries.length} invoice {list.entries.length === 1 ? 'number' : 'numbers'}
        </strong>{' '}
        loaded from {list.fileName}. {verified} of this batch&rsquo;s {total}{' '}
        {total === 1 ? 'invoice is' : 'invoices are'} in it.
      </p>
      <label className="toggle">
        <input
          type="checkbox"
          checked={strict}
          onChange={(event) => onStrict(event.target.checked)}
          data-testid="list-strict"
        />
        <span>
          Only let invoices that are in the list go out without a second look
          <small>Anything not in it is added to the list of things to check.</small>
        </span>
      </label>
      {missing.length > 0 && (
        <details className="list-missing" data-testid="list-missing">
          <summary>
            Expected but not found: {missing.length} {missing.length === 1 ? 'invoice' : 'invoices'}{' '}
            in your list
            {missing.length === 1 ? ' is' : ' are'} not in this batch
          </summary>
          <ul>
            {missing.slice(0, MISSING_SHOWN).map((entry) => (
              <li key={entry.value}>
                <code>{entry.value}</code>
                {entry.client && <span className="muted"> {entry.client}</span>}
              </li>
            ))}
            {missing.length > MISSING_SHOWN && (
              <li className="muted">and {missing.length - MISSING_SHOWN} more</li>
            )}
          </ul>
        </details>
      )}
      <div className="known-list-actions">
        <button type="button" className="link-button" onClick={onChangeColumns}>
          Change columns
        </button>
        <button type="button" className="link-button" onClick={() => input.current?.click()}>
          Load a different list
        </button>
        <button type="button" className="link-button" onClick={onRemove} data-testid="list-remove">
          Stop using this list
        </button>
      </div>
      {picker}
    </section>
  );
}

/** Choosing which column holds the numbers, which the client names, and which the POs. */
function ColumnChoice({ pending, onChoose, onCancel }) {
  const { rows, guess, fileName } = pending;
  const [invoiceColumn, setInvoiceColumn] = useState(guess.invoiceColumn);
  const [clientColumn, setClientColumn] = useState(guess.clientColumn);
  const [poColumn, setPoColumn] = useState(guess.poColumn ?? null);
  const sample = guess.hasHeader ? rows[1] : rows[0];

  const label = (header, column) => {
    const example = sample?.[column];
    return example ? `${header} (for example ${example})` : header;
  };

  return (
    <div className="column-choice" data-testid="list-columns">
      <p>
        <strong>Which columns of {fileName} should be used?</strong> {rows.length}{' '}
        {rows.length === 1 ? 'row' : 'rows'} were read.
      </p>
      <label className="field">
        <span>Invoice numbers</span>
        <select
          value={invoiceColumn}
          onChange={(event) => setInvoiceColumn(Number(event.target.value))}
          data-testid="list-invoice-column"
        >
          {guess.headers.map((header, column) => (
            <option key={column} value={column}>
              {label(header, column)}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Client names (optional)</span>
        <select
          value={clientColumn ?? ''}
          onChange={(event) =>
            setClientColumn(event.target.value === '' ? null : Number(event.target.value))
          }
          data-testid="list-client-column"
        >
          <option value="">None</option>
          {guess.headers.map((header, column) => (
            <option key={column} value={column}>
              {label(header, column)}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>PO numbers (optional)</span>
        <select
          value={poColumn ?? ''}
          onChange={(event) =>
            setPoColumn(event.target.value === '' ? null : Number(event.target.value))
          }
          data-testid="list-po-column"
        >
          <option value="">None</option>
          {guess.headers.map((header, column) => (
            <option key={column} value={column}>
              {label(header, column)}
            </option>
          ))}
        </select>
      </label>
      <div className="known-list-actions">
        <button
          type="button"
          className="button"
          data-testid="list-apply"
          onClick={() =>
            onChoose({ invoiceColumn, clientColumn, poColumn, hasHeader: guess.hasHeader })
          }
        >
          Use this list
        </button>
        <button type="button" className="link-button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
