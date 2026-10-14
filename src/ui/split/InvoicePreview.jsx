import { useEffect, useRef, useState } from 'react';
import { useDialog } from '../../lib/useDialog.js';
import { PreviewPage } from '../reconcile/PdfPreview.jsx';

/**
 * One invoice from the batch, every page of it one under the other, to scroll
 * through from its first. A page can be opened on its own to fix it.
 */
export default function InvoicePreview({ group, docsById, onClose, onDownload, onOpenPage, busy }) {
  const dialogRef = useDialog({ onClose });
  const body = useRef(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const frame = body.current;
    if (!frame) return undefined;
    const measure = () => setWidth(Math.min(860, frame.clientWidth - 32));
    measure();
    const watcher = new ResizeObserver(measure);
    watcher.observe(frame);
    return () => watcher.disconnect();
  }, []);

  const count = group.pages.length;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal pdf-preview"
        role="dialog"
        aria-modal="true"
        aria-label={`Invoice ${group.invoice ?? 'with no number'}`}
        tabIndex={-1}
        ref={dialogRef}
        data-testid="invoice-preview"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="modal-head">
          <div>
            <h2>{group.invoice ? `Invoice ${group.invoice}` : 'No invoice number'}</h2>
            <p className="modal-sub">
              {group.fileName}
              {count > 1 && ` · ${count} pages`}
            </p>
          </div>
          <div className="modal-tools">
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() => onDownload(group)}
              data-testid="invoice-preview-download"
            >
              Download
            </button>
            <button type="button" className="button quiet" onClick={onClose}>
              Close
            </button>
          </div>
        </header>
        <div className="modal-body pdf-preview-body" ref={body}>
          {width > 0 &&
            group.pages.map((page, at) => {
              const doc = docsById.get(page.fileId);
              return doc ? (
                <button
                  key={page.index}
                  type="button"
                  className="preview-page-button"
                  title="Open this page on its own, to fix how it was split or read"
                  onClick={() => onOpenPage(page.index)}
                >
                  <PreviewPage
                    doc={doc}
                    number={page.pageNumberInFile}
                    width={width}
                    label={`Page ${at + 1} of ${count} · page ${page.index} of the batch`}
                  />
                </button>
              ) : null;
            })}
        </div>
      </div>
    </div>
  );
}
