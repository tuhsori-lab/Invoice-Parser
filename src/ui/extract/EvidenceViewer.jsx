import { useEffect, useRef, useState } from 'react';
import { openPdf } from '../../lib/pdfjs.js';
import { getFile } from '../../lib/invoiceApi.js';

/**
 * The uploaded document, page by page, with a box over the words the chosen
 * field was read from. Boxes come in PDF points from the page's top-left, so
 * they are scaled by how wide the page is drawn.
 */
export default function EvidenceViewer({ token, id, pages, focus }) {
  const canvas = useRef(null);
  const frame = useRef(null);
  const [source, setSource] = useState(null); // { pdf } or { image }
  const [pageNumber, setPageNumber] = useState(1);
  const [drawnWidth, setDrawnWidth] = useState(0);
  const [problem, setProblem] = useState('');

  useEffect(() => {
    let cancelled = false;
    let opened = null;
    let url = null;
    setSource(null);
    setProblem('');
    (async () => {
      try {
        const bytes = new Uint8Array(await getFile(token, id));
        const isPdf = new TextDecoder().decode(bytes.slice(0, 1024)).includes('%PDF-');
        if (isPdf) {
          opened = await openPdf(bytes);
          if (!cancelled) setSource({ pdf: opened });
        } else {
          url = URL.createObjectURL(new Blob([bytes]));
          if (!cancelled) setSource({ image: url });
        }
      } catch (error) {
        if (!cancelled) setProblem(error.message || 'The document could not be shown.');
      }
    })();
    return () => {
      cancelled = true;
      opened?.destroy();
      if (url) URL.revokeObjectURL(url);
    };
  }, [token, id]);

  // Follow the field being looked at onto its page.
  useEffect(() => {
    if (focus?.page) setPageNumber(focus.page);
  }, [focus]);

  useEffect(() => {
    if (!source?.pdf || !canvas.current) return undefined;
    let task = null;
    (async () => {
      const page = await source.pdf.getPage(pageNumber);
      const unscaled = page.getViewport({ scale: 1 });
      const width = frame.current?.clientWidth || 600;
      const ratio = window.devicePixelRatio || 1;
      const viewport = page.getViewport({ scale: (width / unscaled.width) * ratio });
      canvas.current.width = viewport.width;
      canvas.current.height = viewport.height;
      canvas.current.style.width = `${width}px`;
      setDrawnWidth(width);
      task = page.render({ canvasContext: canvas.current.getContext('2d'), viewport });
      await task.promise.catch(() => {});
    })();
    return () => task?.cancel();
  }, [source, pageNumber]);

  const info = pages.find((page) => page.number === pageNumber);
  const scale = info && drawnWidth ? drawnWidth / info.width : 0;
  const box = focus && focus.page === pageNumber && scale ? focus.bbox.map((v) => v * scale) : null;
  const count = source?.pdf?.numPages ?? pages.length;

  return (
    <div className="evidence-viewer" data-testid="evidence-viewer">
      {count > 1 && (
        <div className="evidence-pages">
          <button
            type="button"
            className="button quiet"
            disabled={pageNumber <= 1}
            onClick={() => setPageNumber((n) => n - 1)}
          >
            Previous page
          </button>
          <span>
            Page {pageNumber} of {count}
          </span>
          <button
            type="button"
            className="button quiet"
            disabled={pageNumber >= count}
            onClick={() => setPageNumber((n) => n + 1)}
          >
            Next page
          </button>
        </div>
      )}
      <div className="evidence-frame" ref={frame}>
        {problem && <p className="result-empty">{problem}</p>}
        {source?.pdf && <canvas ref={canvas} aria-label={`Page ${pageNumber} of the invoice`} />}
        {source?.image && (
          <img
            src={source.image}
            alt="The uploaded invoice"
            onLoad={(event) => setDrawnWidth(event.currentTarget.clientWidth)}
          />
        )}
        {box && (
          <span
            className="evidence-box"
            data-testid="evidence-box"
            style={{
              left: box[0] - 3,
              top: box[1] - 3,
              width: box[2] - box[0] + 6,
              height: box[3] - box[1] + 6,
            }}
          />
        )}
      </div>
    </div>
  );
}
