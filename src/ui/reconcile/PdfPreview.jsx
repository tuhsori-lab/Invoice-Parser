import { useEffect, useRef, useState } from 'react';
import { openPdf } from '../../lib/pdfjs.js';
import { useDialog } from '../../lib/useDialog.js';
import { downloadInvoicePdf } from '../../lib/invoicePdf.js';
import { useToast } from '../common/Toasts.jsx';

/** Pages are drawn this far ahead of being scrolled to, so they are ready when they arrive. */
const DRAW_AHEAD = '600px';

/**
 * A look at one invoice: all of its pages, one under the other, from its
 * first, to scroll through. Drawn in this browser, each page only as it comes
 * into view, so a long file opens at once.
 */
export default function PdfPreview({ item, onClose }) {
  const dialogRef = useDialog({ onClose });
  const toast = useToast();
  const body = useRef(null);
  const [doc, setDoc] = useState(null);
  const [width, setWidth] = useState(0);
  const [problem, setProblem] = useState('');
  const [saving, setSaving] = useState(false);

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

  // Pages are drawn as wide as the window allows, and redrawn if it changes.
  useEffect(() => {
    const frame = body.current;
    if (!frame) return undefined;
    const measure = () => setWidth(Math.min(860, frame.clientWidth - 32));
    measure();
    const watcher = new ResizeObserver(measure);
    watcher.observe(frame);
    return () => watcher.disconnect();
  }, []);

  // This invoice's pages; a file that is one invoice shows all of its pages.
  const numbers = item.pages?.length
    ? item.pages
    : Array.from({ length: doc?.numPages ?? 0 }, (_, at) => at + 1);

  const download = async () => {
    setSaving(true);
    try {
      toast(`Downloaded ${await downloadInvoicePdf(item)}.`);
    } catch {
      toast('This invoice could not be saved as its own PDF.', { kind: 'error' });
    } finally {
      setSaving(false);
    }
  };

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
            <h2>{item.invoice ? `Invoice ${item.invoice}` : item.fileName}</h2>
            <p className="modal-sub">
              {item.invoice ? item.fileName : 'No invoice number found'}
              {numbers.length > 1 && ` · ${numbers.length} pages`}
            </p>
          </div>
          <div className="modal-tools">
            <button
              type="button"
              className="button"
              onClick={download}
              disabled={saving}
              data-testid="preview-download"
            >
              {saving ? 'Saving…' : 'Download'}
            </button>
            <button type="button" className="button quiet" onClick={onClose}>
              Close
            </button>
          </div>
        </header>
        <div className="modal-body pdf-preview-body" ref={body}>
          {problem ? (
            <p className="problem">{problem}</p>
          ) : (
            doc &&
            width > 0 &&
            numbers.map((number, at) => (
              <PreviewPage
                key={number}
                doc={doc}
                number={number}
                width={width}
                label={`Page ${at + 1} of ${numbers.length}`}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/** One page: its space kept from the start, drawn when it nears the view. */
export function PreviewPage({ doc, number, width, label }) {
  const canvas = useRef(null);
  const holder = useRef(null);
  const [ratio, setRatio] = useState(1.294); // US Letter, until the page says otherwise
  const [near, setNear] = useState(false);

  useEffect(() => {
    const watcher = new IntersectionObserver(([entry]) => entry.isIntersecting && setNear(true), {
      rootMargin: DRAW_AHEAD,
    });
    if (holder.current) watcher.observe(holder.current);
    return () => watcher.disconnect();
  }, []);

  useEffect(() => {
    if (!near || !canvas.current) return undefined;
    let task = null;
    let cancelled = false;
    (async () => {
      const page = await doc.getPage(number);
      if (cancelled) return;
      const unscaled = page.getViewport({ scale: 1 });
      setRatio(unscaled.height / unscaled.width);
      const pixels = window.devicePixelRatio || 1;
      const viewport = page.getViewport({ scale: (width / unscaled.width) * pixels });
      canvas.current.width = viewport.width;
      canvas.current.height = viewport.height;
      task = page.render({ canvasContext: canvas.current.getContext('2d'), viewport });
      await task.promise.catch(() => {});
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, number, width, near]);

  return (
    <figure className="preview-page" ref={holder} style={{ width }}>
      {/* Sized by width and the page's own proportions, so it is never stretched. */}
      <canvas ref={canvas} style={{ width, height: width * ratio }} aria-label={label} />
      <figcaption>{label}</figcaption>
    </figure>
  );
}
