import { useEffect, useMemo, useRef, useState } from 'react';
import { useHiddenColumns } from '../../lib/useHiddenColumns.js';
import { useToast } from '../common/Toasts.jsx';

/** Rows drawn at first; the rest on request, so thousands of rows stay quick. */
const FIRST_ROWS = 300;

/**
 * One section of the results: a heading with its count, a search box, a copy
 * button, and a table that sorts by any column.
 *
 * @param {object} props
 * @param {Array<{ key: string, label: string, numeric?: boolean, wrap?: boolean, rank?: (row: object) => number, render?: (row: object) => import('react').ReactNode }>} props.columns
 *   Cells stay on one line, so rows stay one line tall; `wrap` lets a long text column
 *   run to two lines, with the whole of it in its tooltip; `action` marks a column of
 *   buttons, left out of what is copied.
 *   `rank` sorts by a number other than the cell; `render` draws the cell, which stays the text copied.
 * @param {Array<{ id: string, cells: Record<string, string|number>, flagged?: boolean, alert?: boolean, file?: object }>} props.rows
 *   `alert` tints the whole row red: something on it disagrees and needs a look.
 * @param {(row: object) => void} [props.onOpen] - opens a row's file, when it has one.
 * @param {import('react').ReactNode} [props.toolbar] - drawn above the table, such as a filter.
 * @param {{ key: string, down: boolean }} [props.initialSort] - otherwise the first column, ascending.
 */
export default function ResultSection({
  id,
  title,
  hint,
  toolbar,
  initialSort,
  columns: allColumns,
  rows,
  defaultOpen = true,
  onOpen,
  emptyText,
  hiddenColumns,
  onHiddenColumns,
}) {
  const toast = useToast();
  // Columns somebody has hidden: kept by the caller when it needs them too (for an
  // export), otherwise remembered here.
  const [ownHidden, setOwnHidden] = useHiddenColumns(id);
  const hidden = hiddenColumns ?? ownHidden;
  const setHidden = onHiddenColumns ?? setOwnHidden;
  const columns = useMemo(
    () => allColumns.filter((column) => !hidden.includes(column.key)),
    [allColumns, hidden]
  );
  const [open, setOpen] = useState(defaultOpen);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState(initialSort ?? { key: columns[0]?.key, down: false });
  const [showAll, setShowAll] = useState(false);

  const shown = useMemo(() => {
    const wanted = query.trim().toLowerCase();
    const kept = wanted
      ? rows.filter((row) =>
          columns.some((column) =>
            String(row.cells[column.key] ?? '')
              .toLowerCase()
              .includes(wanted)
          )
        )
      : rows;
    const column = columns.find((entry) => entry.key === sort.key);
    if (!column) return kept;
    const value = (row) => (column.rank ? column.rank(row) : (row.cells[column.key] ?? ''));
    const sorted = [...kept].sort((a, b) =>
      column.numeric || column.rank
        ? (Number(value(a)) || 0) - (Number(value(b)) || 0)
        : String(value(a)).localeCompare(String(value(b)), undefined, {
            numeric: true,
            sensitivity: 'base',
          })
    );
    return sort.down ? sorted.reverse() : sorted;
  }, [rows, columns, query, sort]);

  const copy = async () => {
    // Buttons are not data: they stay out of what is copied.
    const data = columns.filter((column) => !column.action);
    const lines = [
      data.map((column) => column.label).join('\t'),
      ...shown.map((row) =>
        data
          .map((column) => String(row.cells[column.key] ?? '').replace(/[\t\r\n]+/g, ' '))
          .join('\t')
      ),
    ];
    try {
      await navigator.clipboard.writeText(`${lines.join('\n')}\n`);
      toast(`Copied ${shown.length === 1 ? '1 row' : `${shown.length} rows`} from “${title}”.`);
    } catch {
      toast('This browser would not allow copying. Export to Excel instead.', { kind: 'error' });
    }
  };

  const sortBy = (key) =>
    setSort((current) => ({ key, down: current.key === key ? !current.down : false }));

  const visible = showAll ? shown : shown.slice(0, FIRST_ROWS);

  return (
    <section
      className="result-section"
      aria-labelledby={`${id}-heading`}
      data-testid={`section-${id}`}
    >
      <header className="result-head">
        <button
          type="button"
          className="result-toggle"
          aria-expanded={open}
          aria-controls={`${id}-body`}
          onClick={() => setOpen((now) => !now)}
        >
          <span className="result-chevron" aria-hidden="true" />
          <h3 id={`${id}-heading`}>{title}</h3>
          <span className="count-badge" data-testid={`count-${id}`}>
            {rows.length}
          </span>
        </button>
        {open && rows.length > 0 && (
          <div className="result-tools">
            <label className="search">
              <span className="visually-hidden">Search {title}</span>
              <input
                type="search"
                placeholder="Search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                data-testid={`search-${id}`}
              />
            </label>
            <ColumnMenu id={id} columns={allColumns} hidden={hidden} onChange={setHidden} />
            <button
              type="button"
              className="button quiet"
              onClick={copy}
              data-testid={`copy-${id}`}
            >
              Copy
            </button>
          </div>
        )}
      </header>

      {open && (
        <div id={`${id}-body`} className="result-body">
          {toolbar && <div className="result-toolbar">{toolbar}</div>}
          {hint && <p className="result-hint">{hint}</p>}
          {rows.length === 0 ? (
            <p className="result-empty">{emptyText}</p>
          ) : shown.length === 0 ? (
            <p className="result-empty">Nothing here matches &ldquo;{query}&rdquo;.</p>
          ) : (
            <div className="data-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    {columns.map((column) => (
                      <th
                        key={column.key}
                        scope="col"
                        aria-sort={
                          sort.key === column.key
                            ? sort.down
                              ? 'descending'
                              : 'ascending'
                            : 'none'
                        }
                      >
                        <button type="button" onClick={() => sortBy(column.key)}>
                          {column.label}
                          <span className="sort-mark" aria-hidden="true">
                            {sort.key === column.key ? (sort.down ? '↓' : '↑') : ''}
                          </span>
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((row) => (
                    <tr
                      key={row.id}
                      className={`${row.flagged ? 'is-flagged' : ''}${row.file && onOpen ? ' is-openable' : ''}${row.alert ? ' is-alert' : ''}`}
                      onClick={row.file && onOpen ? () => onOpen(row) : undefined}
                      data-testid={`row-${row.id}`}
                    >
                      {columns.map((column) => (
                        <td
                          key={column.key}
                          className={
                            [column.numeric && 'is-number', column.wrap && 'is-wrap']
                              .filter(Boolean)
                              .join(' ') || undefined
                          }
                          title={column.wrap ? String(row.cells[column.key] ?? '') : undefined}
                        >
                          {column.key === 'file' && row.file && onOpen ? (
                            <button
                              type="button"
                              className="link-button"
                              onClick={(event) => {
                                event.stopPropagation();
                                onOpen(row);
                              }}
                              title={`Preview ${row.cells[column.key]}`}
                            >
                              {row.cells[column.key]}
                            </button>
                          ) : column.render ? (
                            column.render(row)
                          ) : column.wrap ? (
                            <span className="clamp">{row.cells[column.key]}</span>
                          ) : (
                            row.cells[column.key]
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!showAll && shown.length > FIRST_ROWS && (
            <button type="button" className="link-button show-all" onClick={() => setShowAll(true)}>
              Show all {shown.length} rows
            </button>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * Which columns to show, as a Mac menu: a tick by each one that is showing.
 * Closes on Escape or a click anywhere else; one column always stays.
 */
function ColumnMenu({ id, columns, hidden, onChange }) {
  const menu = useRef(null);

  useEffect(() => {
    const close = (event) => {
      const box = menu.current;
      if (!box?.open) return;
      if (event.type === 'keydown' ? event.key === 'Escape' : !box.contains(event.target)) {
        box.open = false;
      }
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, []);

  const showing = columns.filter((column) => !hidden.includes(column.key)).length;
  const toggle = (key) =>
    onChange(hidden.includes(key) ? hidden.filter((entry) => entry !== key) : [...hidden, key]);

  return (
    <details className="column-menu" ref={menu} data-testid={`columns-${id}`}>
      <summary className="button quiet">
        Columns
        {showing < columns.length && (
          <span className="column-count">
            {showing}/{columns.length}
          </span>
        )}
      </summary>
      <div className="column-menu-panel glass" role="group" aria-label="Columns to show">
        {columns.map((column) => {
          const on = !hidden.includes(column.key);
          return (
            <label key={column.key} className="column-option">
              <input
                type="checkbox"
                checked={on}
                disabled={on && showing === 1}
                onChange={() => toggle(column.key)}
                data-testid={`column-${column.key}`}
              />
              <span className="column-tick" aria-hidden="true" />
              {column.label}
            </label>
          );
        })}
        {hidden.length > 0 && (
          <button type="button" className="column-reset" onClick={() => onChange([])}>
            Show all columns
          </button>
        )}
      </div>
    </details>
  );
}
