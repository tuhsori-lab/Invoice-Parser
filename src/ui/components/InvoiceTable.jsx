import { useEffect, useRef, useState } from 'react';
import { tileClass } from '../colors.js';
import { pageRangeForCsv } from '../../core/naming.js';
import { FLAG_LABELS } from '../../core/group.js';

/** Plain words for where a number came from. */
const SOURCE_WORDS = {
  profile: 'a label you saved',
  common: 'an everyday label',
  bare: 'the word "Invoice" alone',
  custom: 'your own pattern',
};

/**
 * Every invoice the batch was split into, and what it will be saved as.
 *
 * The number can be corrected in place: click it, type, press Enter. A number
 * typed by hand is kept even when a detection setting changes afterwards.
 */
export default function InvoiceTable({ groups, colourOf, onPreview, onDownload, onRename, busy }) {
  if (groups.length === 0) return null;

  return (
    <div className="table-wrap">
      <table className="invoice-table" data-testid="invoice-table">
        <caption className="visually-hidden">
          The invoices this batch will be split into, in page order.
        </caption>
        <thead>
          <tr>
            <th scope="col" className="column-swatch">
              <span className="visually-hidden">Colour</span>
            </th>
            <th scope="col">Invoice</th>
            <th scope="col">Found after</th>
            <th scope="col">Extra</th>
            <th scope="col">Pages</th>
            <th scope="col" className="column-number">
              Page count
            </th>
            <th scope="col">Saved as</th>
            <th scope="col">
              <span className="visually-hidden">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <tr
              key={group.id}
              className={group.flags.length > 0 ? 'row-flagged' : ''}
              data-testid={`invoice-row-${group.id}`}
            >
              <td className="column-swatch">
                <span
                  className={`swatch tile ${tileClass(colourOf.get(group.id) ?? 0)}`}
                  aria-hidden="true"
                />
              </td>
              <th scope="row" className="column-invoice">
                <InvoiceNumber group={group} onRename={onRename} />
                {group.flags.length > 0 && (
                  <span className="flag-list">
                    {group.flags.map((flag) => (
                      <span key={flag} className="flag">
                        {FLAG_LABELS[flag] ?? flag}
                      </span>
                    ))}
                  </span>
                )}
              </th>
              <td className="column-provenance">
                {!group.provenance ? (
                  <span className="muted">&mdash;</span>
                ) : group.provenance.source === 'manual' ? (
                  // A number somebody typed was not found after anything, so it
                  // is said once, in plain words, rather than shown as page text.
                  <span className="muted">Typed by you</span>
                ) : (
                  <>
                    <code>{group.provenance.label}</code>
                    <small>
                      {SOURCE_WORDS[group.provenance.source] ?? group.provenance.source}
                    </small>
                  </>
                )}
              </td>
              <td>{group.extra?.value ?? <span className="muted">&mdash;</span>}</td>
              <td className="column-pages">{pageRangeForCsv(group.pages.map((p) => p.index))}</td>
              <td className="column-number">{group.pages.length}</td>
              <td className="column-filename">{group.fileName}</td>
              <td className="column-actions">
                <button
                  type="button"
                  className="link-button"
                  onClick={() => onPreview(group.pages[0].index)}
                >
                  Preview
                </button>
                <button
                  type="button"
                  className="link-button"
                  disabled={busy}
                  onClick={() => onDownload(group)}
                >
                  Download
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The invoice number, correctable in place. */
function InvoiceNumber({ group, onRename }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(group.invoice ?? '');
  const input = useRef(null);

  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  const start = () => {
    setDraft(group.invoice ?? '');
    setEditing(true);
  };

  const commit = () => {
    setEditing(false);
    if (draft.trim() !== (group.invoice ?? '')) onRename(group.id, draft);
  };

  if (editing) {
    return (
      <input
        ref={input}
        type="text"
        className="invoice-input"
        value={draft}
        data-testid={`invoice-input-${group.id}`}
        aria-label={`Invoice number for pages ${pageRangeForCsv(group.pages.map((p) => p.index))}`}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            setEditing(false);
          }
        }}
      />
    );
  }

  return (
    <button
      type="button"
      className="invoice-value"
      data-testid={`invoice-value-${group.id}`}
      title="Click to correct this number"
      onClick={start}
    >
      {group.invoice ?? <span className="muted">No number found</span>}
      {group.manual && (
        <span className="edited" title="Changed by you">
          edited
        </span>
      )}
    </button>
  );
}
