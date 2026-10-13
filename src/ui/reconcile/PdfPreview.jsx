import { useEffect, useRef, useState } from 'react';
import { openPdf } from '../../lib/pdfjs.js';
import { useDialog } from '../../lib/useDialog.js';

/** A look at one invoice PDF, page by page, drawn in this browser. */
export default function PdfPreview({ item, onClose }) {
  const dialogRef = useDialog({ onClose });
  const canvas = useRef(null);
  const [doc, setDoc] = useState(null);
  // A file split into several invoices opens on this invoice's first page.
  const [pageNumber, setPageNumber] = useState(item.pages?.[0] ?? 1);
  const [problem, setProblem] = useState('');

  useEffect(() => {
    let open = null;
    let cancelled = false;
    (async () => {
      try {
        open = await openPdf(new Uint8Array(await item.file.arrayBuffer()));
        if (cancelled) open.destroy();
        else setDoc(open);
      } catch {
        if (!cancelled) setProblem('This file could not be opened.');
      }
    })();
    return () => {
      cancelled = true;
      open?.destroy();
    };
  }, [item]);

  useEffect(() => {
    if (!doc || !canvas.current) return undefined;
    let task = null;
    (async () => {
      const page = await doc.getPage(pageNumber);
      const unscaled = page.getViewport({ scale: 1 });
      const width = Math.min(860, canvas.current.parentElement?.clientWidth || 860);
      const ratio = window.devicePixelRatio || 1;
      const viewport = page.getViewport({ scale: (width / unscaled.width) * ratio });
      canvas.current.width = viewport.width;
      canvas.current.height = viewport.height;
      canvas.current.style.width = `${viewport.width / ratio}px`;
      task = page.render({ canvasContext: canvas.current.getContext('2d'), viewport });
      await task.promise.catch(() => {});
    })();
    return () => task?.cancel();
  }, [doc, pageNumber]);

  const pages = doc?.numPages ?? 0;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal pdf-preview"
        role="dialog"
        aria-modal="true"
        aria-label={`Preview of ${item.fileName}`}
        tabIndex={-1}
        ref={dialogRef}
        data-testid="pdf-preview"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="modal-head">
          <div>
            <h2>{item.fileName}</h2>
            <p className="modal-sub">
              {item.invoice ? <>Invoice {item.invoice}</> : 'No invoice number found'}
              {pages > 1 && ` · page ${pageNumber} of ${pages}`}
            </p>
          </div>
          <div className="modal-tools">
            {pages > 1 && (
              <>
                <button
                  type="button"
                  className="button quiet"
                  disabled={pageNumber <= 1}
                  onClick={() => setPageNumber((n) => n - 1)}
                >
                  Previous page
                </button>
                <button
                  type="button"
                  className="button quiet"
                  disabled={pageNumber >= pages}
                  onClick={() => setPageNumber((n) => n + 1)}
                >
                  Next page
                </button>
              </>
            )}
            <button type="button" className="button quiet" onClick={onClose}>
              Close
            </button>
          </div>
        </header>
        <div className="modal-body pdf-preview-body">
          {problem ? <p className="problem">{problem}</p> : <canvas ref={canvas} />}
        </div>
      </div>
    </div>
  );
}
