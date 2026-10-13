import DropArea from '../common/DropArea.jsx';
import { SHEET_TYPES } from '../../lib/sheets.js';

/** The right-hand side: the spreadsheet, which sheet, and which columns. */
export default function SheetInput({
  workbook,
  sheetIndex,
  layout,
  carry,
  parsed,
  error,
  onFiles,
  onSheet,
  onColumn,
  onCarry,
  onClear,
}) {
  const sheet = workbook?.sheets[sheetIndex];
  const sample = (column) => {
    const rows = sheet?.rows ?? [];
    for (let at = layout.headerRow + 1; at < rows.length; at += 1) {
      const value = String(rows[at]?.[column] ?? '').trim();
      if (value) return value;
    }
    return '';
  };
  const label = (header, column) => {
    const example = sample(column);
    return example ? `${header} (e.g. ${example.slice(0, 24)})` : header;
  };

  return (
    <section
      className="input-panel"
      aria-labelledby="sheet-input-heading"
      data-testid="sheet-input"
    >
      <header className="input-panel-head">
        <h3 id="sheet-input-heading">Spreadsheet</h3>
        {workbook && (
          <button type="button" className="link-button" onClick={onClear} data-testid="sheet-clear">
            Clear
          </button>
        )}
      </header>

      {!workbook ? (
        <DropArea
          title="Drop an Excel or CSV file"
          note="The list of invoices to check the PDFs against."
          accept={SHEET_TYPES.join(',')}
          multiple={false}
          onFiles={onFiles}
          inputLabel="Spreadsheet of invoices"
          testId="sheet-drop"
        />
      ) : (
        <div className="sheet-choice">
          <p className="input-summary-main">{workbook.fileName}</p>
          {workbook.sheets.length > 1 && (
            <label className="field">
              <span>Sheet</span>
              <select
                value={sheetIndex}
                onChange={(event) => onSheet(Number(event.target.value))}
                data-testid="sheet-select"
              >
                {workbook.sheets.map((entry, index) => (
                  <option key={entry.name} value={index}>
                    {entry.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="field">
            <span>Invoice numbers are in</span>
            <select
              value={layout.invoiceColumn}
              onChange={(event) => onColumn(Number(event.target.value))}
              data-testid="sheet-invoice-column"
            >
              {layout.headers.map((header, column) => (
                <option key={column} value={column}>
                  {label(header, column)}
                </option>
              ))}
            </select>
            <small>
              {layout.headerRow >= 0
                ? `Headings found on row ${(sheet?.firstRow ?? 1) + layout.headerRow}.`
                : 'No heading row found; every row is read as an invoice.'}
            </small>
          </label>
          {layout.headers.length > 1 && (
            <fieldset className="carry-over">
              <legend>Columns to carry over into the results</legend>
              {layout.headers.map((header, column) =>
                column === layout.invoiceColumn ? null : (
                  <label key={column} className="choice">
                    <input
                      type="checkbox"
                      checked={carry.includes(column)}
                      onChange={(event) => onCarry(column, event.target.checked)}
                      data-testid={`carry-${column}`}
                    />
                    <span>{header}</span>
                  </label>
                )
              )}
            </fieldset>
          )}
          {parsed && (
            <p className="input-summary-note" data-testid="sheet-summary">
              {parsed.entries.length === 1
                ? '1 invoice number'
                : `${parsed.entries.length} invoice numbers`}
              {parsed.blank > 0 &&
                `, and ${parsed.blank} ${parsed.blank === 1 ? 'row' : 'rows'} with this column empty`}
              .
            </p>
          )}
          {parsed?.problem && (
            <p className="problem" role="alert" data-testid="sheet-problem">
              {parsed.problem}
            </p>
          )}
        </div>
      )}
      {error && (
        <p className="problem" role="alert" data-testid="sheet-error">
          {error}
        </p>
      )}
    </section>
  );
}
