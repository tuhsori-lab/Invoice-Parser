import { useEffect, useRef, useState } from 'react';
import { TextLayer } from '../../lib/pdfjs.js';

/** How wide the rendered page is drawn, in CSS pixels. */
const PAGE_WIDTH = 660;

/**
 * One page, big enough to read, with the text pdf.js found sitting invisibly on
 * top of it. The text layer is what makes the page selectable now, and what
 * teaching a label by highlighting will use later.
 */
export default function PreviewModal({ page, group, doc, onClose, onStep, onDownload, busy }) {
  const canvasRef = useRef(null);
  const textRef = useRef(null);
  const dialogRef = useRef(null);
  const [drawing, setDrawing] = useState(true);

  // Draw the page, and put its text on top of it.
  useEffect(() => {
    if (!doc || !page) return undefined;
    let cancelled = false;
    let task = null;
    setDrawing(true);

    (async () => {
      const pdfPage = await doc.getPage(page.pageNumberInFile);
      if (cancelled) return;
      const unscaled = pdfPage.getViewport({ scale: 1 });
      const scale = PAGE_WIDTH / unscaled.width;
      const viewport = pdfPage.getViewport({ scale });
      const canvas = canvasRef.current;
      const layer = textRef.current;
      if (!canvas || !layer) return;

      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.ceil(viewport.width * ratio);
      canvas.height = Math.ceil(viewport.height * ratio);
      canvas.style.width = `${Math.ceil(viewport.width)}px`;
      canvas.style.height = `${Math.ceil(viewport.height)}px`;

      task = pdfPage.render({
        canvasContext: canvas.getContext('2d'),
        viewport,
        transform: ratio === 1 ? null : [ratio, 0, 0, ratio, 0, 0],
      });
      await task.promise;
      if (cancelled) return;

      layer.replaceChildren();
      layer.style.width = `${Math.ceil(viewport.width)}px`;
      layer.style.height = `${Math.ceil(viewport.height)}px`;
      layer.style.setProperty('--scale-factor', String(scale));
      const textLayer = new TextLayer({
        textContentSource: await pdfPage.getTextContent(),
        container: layer,
        viewport,
      });
      await textLayer.render();
      if (!cancelled) setDrawing(false);
    })().catch(() => {
      if (!cancelled) setDrawing(false);
    });

    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, page]);

  // Arrow keys step through pages; Esc closes.
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') onClose();
      else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') onStep(1);
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') onStep(-1);
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    dialogRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onStep]);

  if (!page) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Page ${page.index}`}
        tabIndex={-1}
        ref={dialogRef}
        data-testid="preview-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="modal-head">
          <div>
            <h2>Page {page.index}</h2>
            <p className="modal-sub">
              {group?.invoice ? (
                <>
                  Invoice <strong>{group.invoice}</strong>
                  {group.provenance?.label && (
                    <>
                      , found after <code>{group.provenance.label}</code>
                    </>
                  )}
                </>
              ) : (
                'No invoice number was found on this page.'
              )}
            </p>
          </div>
          <div className="modal-tools">
            <button type="button" className="button quiet" onClick={() => onStep(-1)}>
              Previous
            </button>
            <button type="button" className="button quiet" onClick={() => onStep(1)}>
              Next
            </button>
            {group && (
              <button
                type="button"
                className="button"
                disabled={busy}
                onClick={() => onDownload(group)}
              >
                Download this invoice
              </button>
            )}
            <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
              &times;
            </button>
          </div>
        </header>

        <div className="modal-body">
          <div className="page-view">
            <div className="page-sheet">
              <canvas ref={canvasRef} className="page-canvas" />
              <div ref={textRef} className="textLayer" />
              {drawing && <p className="page-drawing">Drawing the page&hellip;</p>}
            </div>
          </div>

          <aside className="text-panel">
            <h3>Text found on this page</h3>
            {page.text ? (
              <pre data-testid="page-text">{page.text}</pre>
            ) : (
              <p className="muted">
                No readable text was found. This looks like a scan. Text recognition can read it.
              </p>
            )}
            <p className="text-panel-source">
              From {page.fileName}, page {page.pageNumberInFile}
            </p>
          </aside>
        </div>
      </div>
    </div>
  );
}
