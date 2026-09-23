import { tileClass } from '../colors.js';
import { pageRangeForCsv } from '../../core/naming.js';

/** Plain words for where a number came from. */
const SOURCE_WORDS = {
  profile: 'a label you saved',
  common: 'an everyday label',
  bare: 'the word "Invoice" alone',
  custom: 'your own pattern',
  manual: 'you',
};

/**
 * Every invoice the batch was split into, and what it will be saved as.
 */
export default function InvoiceTable({ groups, onPreview, onDownload, busy }) {
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
          {groups.map((group, index) => (
            <tr key={group.id} data-testid={`invoice-row-${group.id}`}>
              <td className="column-swatch">
                <span className={`swatch tile ${tileClass(index)}`} aria-hidden="true" />
              </td>
              <th scope="row" className="column-invoice">
                {group.invoice ?? <span className="muted">No number found</span>}
              </th>
              <td className="column-provenance">
                {group.provenance ? (
                  <>
                    <code>{group.provenance.label}</code>
                    <small>
                      {SOURCE_WORDS[group.provenance.source] ?? group.provenance.source}
                    </small>
                  </>
                ) : (
                  <span className="muted">&mdash;</span>
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
