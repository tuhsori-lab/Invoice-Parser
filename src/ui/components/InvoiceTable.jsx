import { useEffect, useMemo, useRef, useState } from 'react';
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

/** Past this many invoices, only the rows on screen are drawn. */
export const VIRTUAL_THRESHOLD = 200;

/**
 * How tall one row is when the table is being drawn a screenful at a time.
 * Kept in step with the fixed row height styles.css gives a virtual table:
 * the scroll position is worked out from this, so rows that grew taller than
 * it would slide out of place as you scrolled.
 */
const ROW_HEIGHT = 40;

/** Rows kept ready just outside the view, so scrolling does not flicker. */
const OVERSCAN = 6;

/**
 * Every invoice the batch was split into, and what it will be saved as.
 *
 * The number can be corrected in place: click it, type, press Enter. A number
 * typed by hand is kept even when a detection setting changes afterwards.
 *
 * A batch of four hundred invoices is four hundred rows, each with a handful of
 * elements in it, which is enough to make scrolling stutter. Past a couple of
 * hundred the table draws only the rows in view and props the scrollbar up with
 * an empty row above and below, so the page stays the right height and
 * scrolling stays smooth.
 */
export default function InvoiceTable({ groups, colourOf, onPreview, onDownload, onRename, busy }) {
  const scroller = useRef(null);
  const [view, setView] = useState({ top: 0, height: 0 });

  const virtual = groups.length > VIRTUAL_THRESHOLD;

  useEffect(() => {
    if (!virtual) return undefined;
    const element = scroller.current;
    if (!element) return undefined;
    const measure = () => setView({ top: element.scrollTop, height: element.clientHeight });
    measure();
    element.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    return () => {
      element.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, [virtual]);

  const window_ = useMemo(() => {
    if (!virtual) return { from: 0, to: groups.length, above: 0, below: 0 };
    const visible = Math.ceil((view.height || 600) / ROW_HEIGHT);
    const from = Math.max(0, Math.floor(view.top / ROW_HEIGHT) - OVERSCAN);
    const to = Math.min(groups.length, from + visible + OVERSCAN * 2);
    return {
      from,
      to,
      above: from * ROW_HEIGHT,
      below: (groups.length - to) * ROW_HEIGHT,
    };
  }, [virtual, view, groups.length]);

  if (groups.length === 0) return null;

  const shown = groups.slice(window_.from, window_.to);

  return (
    <div
      className={`table-wrap${virtual ? ' table-virtual' : ''}`}
      ref={scroller}
      data-testid="table-scroller"
    >
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
          {window_.above > 0 && (
            <tr aria-hidden="true" className="spacer">
              <td colSpan={8} style={{ height: window_.above }} />
            </tr>
          )}
          {shown.map((group) => (
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
          {window_.below > 0 && (
            <tr aria-hidden="true" className="spacer">
              <td colSpan={8} style={{ height: window_.below }} />
            </tr>
          )}
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
