import { useState } from 'react';

/**
 * Beside the invoice being looked at: what was read from it, what Excel says,
 * and a place to put either right - so a number can be checked against the page
 * it is printed on. A change is saved on Enter or on leaving the field.
 */
export default function InvoiceDetails({ item, row, statusLabel, status, onSave }) {
  const fields = [
    {
      key: 'invoice',
      label: 'Invoice number',
      value: item.invoice ?? '',
      sheet: row?.cells.sheetInvoice ?? '',
      // Numbers are compared after their clean-up, so only a missing one is a problem here.
      differs: false,
    },
    {
      key: 'po',
      label: 'PO number',
      value: item.fields?.po?.value ?? '',
      sheet: row?.cells.sheetPo ?? '',
      differs: status === 'poDiffers',
      from: row?.cells.pdfPoFrom,
    },
    {
      key: 'total',
      label: 'Amount',
      value: item.fields?.total?.raw ?? '',
      sheet: row?.cells.sheetAmount ?? '',
      differs: status === 'priceDiffers',
      from: row?.cells.pdfAmountFrom,
      note: row?.cells.difference ? `Difference ${row.cells.difference}` : '',
    },
  ];

  return (
    <aside
      className="invoice-details"
      aria-label="This invoice's details"
      data-testid="invoice-details"
    >
      {statusLabel && (
        <p className={`status status-${status}`} data-testid="details-status">
          {statusLabel}
        </p>
      )}
      {fields.map((field) => (
        <DetailField key={field.key} field={field} onSave={onSave} />
      ))}
      <p className="details-hint">
        Change a value and press Enter. A PO or amount you enter teaches it where to find the rest,
        as in the table.
      </p>
    </aside>
  );
}

function DetailField({ field, onSave }) {
  const [draft, setDraft] = useState(field.value);
  // A value changed elsewhere - by learning, or the table - shows here too.
  const [shown, setShown] = useState(field.value);
  if (shown !== field.value) {
    setShown(field.value);
    setDraft(field.value);
  }
  const save = () => {
    const value = draft.trim();
    if (value && value !== field.value) onSave(field.key, value);
    else setDraft(field.value);
  };
  const tag = field.from ? field.from.split(':')[0] : '';

  return (
    <div className={`detail-field${field.differs ? ' is-different' : ''}`}>
      <label htmlFor={`detail-${field.key}`}>
        {field.label}
        {tag && <span className="value-tag">{tag}</span>}
      </label>
      <input
        type="text"
        id={`detail-${field.key}`}
        value={draft}
        placeholder="Not found on the PDF"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={save}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') {
            // Undo the typing, rather than close the preview.
            event.stopPropagation();
            setDraft(field.value);
          }
        }}
        data-testid={`detail-${field.key}`}
      />
      <p className="detail-sheet">
        {field.sheet ? (
          <>
            Excel: <strong>{field.sheet}</strong>
          </>
        ) : (
          'Not in Excel'
        )}
        {field.note && <span className="detail-note">{field.note}</span>}
      </p>
    </div>
  );
}
