import { tileClass } from '../colors.js';
import { pageRangeForCsv } from '../../core/naming.js';
import { useToast } from '../common/Toasts.jsx';

/**
 * The purchase order behind every invoice in the batch, in one list.
 *
 * Collections work runs on POs as much as on invoice numbers: a customer's
 * accounts payable team files by their own order number, so that is the number
 * a remittance, a dispute or a chase refers to. This puts them side by side
 * with the invoice they belong to, and copies them out as two columns that
 * paste straight into a spreadsheet or an email.
 *
 * It lists what the table lists, so a search narrows both, and it copies
 * exactly what it lists.
 */
export default function PurchaseOrders({ groups, colourOf, onOpenPage }) {
  const toast = useToast();

  if (groups.length === 0) return null;

  const found = groups.filter((group) => group.po?.value).length;
  const total = groups.length;
  let count;
  if (total === 1) count = found ? 'Found on the one invoice.' : 'Not found on the one invoice.';
  else if (found === total) count = `Found on all ${total} invoices.`;
  else if (found === 0) count = `Not found on any of the ${total} invoices.`;
  else count = `Found on ${found} of ${total} invoices.`;

  const copy = async () => {
    // Tab-separated with a heading row: pasted into a spreadsheet it lands as
    // two labelled columns, and pasted into an email it still lines up.
    const rows = [
      'Invoice\tPO',
      ...groups.map((group) => `${group.invoice ?? ''}\t${group.po?.value ?? ''}`),
    ];
    try {
      await navigator.clipboard.writeText(`${rows.join('\n')}\n`);
      toast(
        `Copied ${groups.length === 1 ? '1 row' : `${groups.length} rows`}. Paste it anywhere.`,
        { testId: 'po-copied' }
      );
    } catch {
      toast('This browser would not allow copying. Select the list instead.', {
        kind: 'error',
        testId: 'po-copied',
      });
    }
  };

  return (
    <section className="po-list" aria-labelledby="po-heading" data-testid="po-list">
      <header className="po-head">
        <div>
          <h2 id="po-heading">PO numbers</h2>
          <p className="po-count" data-testid="po-count">
            {count}
          </p>
        </div>
        <div className="po-actions">
          <button type="button" className="button quiet" onClick={copy} data-testid="po-copy">
            Copy list
          </button>
        </div>
      </header>

      <div className="po-scroll">
        <table className="po-table">
          <thead>
            <tr>
              <th scope="col">Invoice</th>
              <th scope="col">PO</th>
              <th scope="col">Found after</th>
              <th scope="col">Pages</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <tr key={group.id} data-testid={`po-row-${group.id}`}>
                <td>
                  <span
                    className={`swatch tile ${tileClass(colourOf.get(group.id) ?? 0)}`}
                    aria-hidden="true"
                  />
                  {group.invoice ?? <span className="muted">No number</span>}
                </td>
                <td>
                  {group.po?.value ? (
                    <span className="po-value">{group.po.value}</span>
                  ) : group.pages.some((page) => page.partial) ? (
                    // Only the top, the box and the foot of a scanned page were
                    // read, to be quicker: a PO number elsewhere would be missed.
                    <span className="muted" data-testid={`po-not-read-${group.id}`}>
                      not read (scan)
                    </span>
                  ) : (
                    <span className="muted">none found</span>
                  )}
                </td>
                <td>
                  {group.po?.label ? (
                    <code>{group.po.label}</code>
                  ) : (
                    <span className="muted">&mdash;</span>
                  )}
                </td>
                <td>
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => onOpenPage(group.pages[0].index)}
                    aria-label={`Open page ${group.pages[0].index}`}
                  >
                    {pageRangeForCsv(group.pages.map((page) => page.index))}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
