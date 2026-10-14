import DropArea from '../common/DropArea.jsx';
import { isPdfFile } from '../../lib/droppedFiles.js';

/**
 * Where a batch comes in, as a panel like Reconcile's inputs.
 *
 * Takes several PDFs at once and keeps the order they were chosen in, because
 * that order is the order of the pages. Once files are loaded the drop area
 * gives way to what was loaded, so the work takes the space.
 */
export default function DropZone({ files, pageCount, onFiles, onClear, busy }) {
  return (
    <section
      className="input-panel"
      aria-labelledby="split-input-heading"
      data-testid="split-input"
    >
      <header className="input-panel-head">
        <h3 id="split-input-heading">PDFs to split</h3>
        {files.length > 0 && (
          <button type="button" className="link-button" onClick={onClear}>
            Start again
          </button>
        )}
      </header>

      {files.length > 0 ? (
        <div className="input-summary" data-testid="file-bar">
          <p className="input-summary-main">
            {files.length === 1 ? '1 file' : `${files.length} files`}, {pageCount}{' '}
            {pageCount === 1 ? 'page' : 'pages'}
          </p>
          <ul>
            {files.map((file, position) => (
              <li key={`${file.name}-${position}`}>{file.name}</li>
            ))}
          </ul>
        </div>
      ) : (
        <DropArea
          title="Drop your PDFs here"
          note="Several files at once is fine. They are read in the order you choose them."
          accept="application/pdf,.pdf"
          onFiles={(found) => {
            const pdfs = found.map(({ file }) => file).filter(isPdfFile);
            if (pdfs.length > 0) onFiles(pdfs);
          }}
          busy={busy}
          inputLabel="Choose PDF files to split"
          testId="file"
        />
      )}
    </section>
  );
}
