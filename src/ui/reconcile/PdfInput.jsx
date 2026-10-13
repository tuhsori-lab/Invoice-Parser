import DropArea from '../common/DropArea.jsx';
import ProgressBar from '../common/ProgressBar.jsx';

/** The left-hand side: the invoice PDFs, and how their numbers were found. */
export default function PdfInput({
  items,
  reading,
  scanReading,
  onFiles,
  onCancel,
  onClear,
  onReadScans,
}) {
  const busy = Boolean(reading || scanReading);
  const fileCount = new Set(items.map((item) => item.fileId)).size;
  const fromText = items.filter((item) => item.source === 'text').length;
  const fromScan = items.filter((item) => item.source === 'scan').length;
  const fromName = items.filter((item) => item.source === 'filename').length;
  const unreadable = items.filter((item) => !item.invoice).length;
  const scans = items.filter((item) => item.scan && item.source !== 'scan').length;

  return (
    <section className="input-panel" aria-labelledby="pdf-input-heading" data-testid="pdf-input">
      <header className="input-panel-head">
        <h3 id="pdf-input-heading">Invoice PDFs</h3>
        {items.length > 0 && !busy && (
          <button type="button" className="link-button" onClick={onClear} data-testid="pdf-clear">
            Clear
          </button>
        )}
      </header>

      {items.length === 0 && !reading ? (
        <DropArea
          title="Drop invoice PDFs or a folder"
          note="Files holding many invoices are split. Sub-folders are included."
          accept="application/pdf,.pdf"
          folders
          onFiles={onFiles}
          busy={busy}
          inputLabel="Invoice PDFs"
          testId="pdf-drop"
        />
      ) : (
        <>
          {items.length > 0 && (
            <div className="input-summary" data-testid="pdf-summary">
              <p className="input-summary-main">
                {fileCount === 1 ? '1 file' : `${fileCount} files`},{' '}
                {items.length === 1 ? '1 invoice' : `${items.length} invoices`}
              </p>
              <ul>
                {fromText > 0 && <li>{fromText} numbered from their own text</li>}
                {fromScan > 0 && <li>{fromScan} read from a scan</li>}
                {fromName > 0 && <li>{fromName} numbered from the file name</li>}
                {unreadable > 0 && <li className="problem">{unreadable} could not be checked</li>}
              </ul>
            </div>
          )}
          {reading && (
            <ProgressBar
              label={`Reading ${reading.done + 1 > reading.total ? reading.total : reading.done + 1} of ${reading.total}${reading.fileName ? ` — ${reading.fileName}` : ''}`}
              done={reading.done}
              total={reading.total}
              onCancel={onCancel}
              testId="pdf-progress"
            />
          )}
          {scanReading && (
            <ProgressBar
              label={`Reading scanned files — ${scanReading.done} of ${scanReading.total}`}
              done={scanReading.done}
              total={scanReading.total}
              onCancel={onCancel}
              cancelLabel="Stop"
              testId="scan-progress"
            />
          )}
          {scans > 0 && !busy && (
            <div className="scan-offer" data-testid="scan-offer">
              <p>
                {scans === 1
                  ? 'One file is a scan with no text in it.'
                  : `${scans} files are scans with no text in them.`}{' '}
                Their numbers can be read with text recognition, which is slower.
              </p>
              <button
                type="button"
                className="button quiet"
                onClick={onReadScans}
                data-testid="read-scanned-files"
              >
                Read scanned files
              </button>
            </div>
          )}
          {!busy && (
            <DropArea
              title="Add more PDFs"
              accept="application/pdf,.pdf"
              folders
              compact
              onFiles={onFiles}
              inputLabel="More invoice PDFs"
              testId="pdf-drop-more"
            />
          )}
        </>
      )}
    </section>
  );
}
