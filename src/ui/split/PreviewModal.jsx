import { useEffect, useRef, useState } from 'react';
import { TextLayer } from '../../lib/pdfjs.js';
import { detectInZone, valueShape } from '../../core/detect.js';
import { useDialog } from '../../lib/useDialog.js';

/** How wide the rendered page is drawn, in CSS pixels. */
const PAGE_WIDTH = 660;

/** A box smaller than this, in screen pixels, was a click rather than a drag. */
const MIN_BOX = 6;

/** Keep a fraction of the page on the page. */
const clamp = (value) => Math.min(1, Math.max(0, value));

/**
 * One page, big enough to read, with the text pdf.js found sitting invisibly on
 * top of it.
 *
 * "Point to the invoice number" turns the page into something like a screenshot
 * tool: drag a box around the number, and every page from that client is read
 * from inside that box from then on, in this batch and their next one.
 */
export default function PreviewModal({
  page,
  group,
  doc,
  onClose,
  onStep,
  onDownload,
  onMoveToNeighbour,
  canMoveBack,
  canMoveOn,
  onTeachZone,
  onForgetBox,
  pointing = false,
  unreadScan = false,
  newClientName = '',
  spotInvoices = 0,
  busy,
}) {
  const canvasRef = useRef(null);
  const textRef = useRef(null);
  const dragRef = useRef(null);
  const dialogRef = useDialog({ onClose });
  const [drawing, setDrawing] = useState(true);
  const [taught, setTaught] = useState(null);
  const [picking, setPicking] = useState(pointing);
  const [box, setBox] = useState(null);
  const [spot, setSpot] = useState(null);

  // Opened from "Point to it" on the results page: go straight to drawing.
  useEffect(() => {
    if (pointing) setPicking(true);
  }, [pointing]);

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

  // A new page means a new selection to make, and the last page's news is
  // stale. Keyed on the page number rather than the page itself: the page
  // object is rebuilt every time detection re-runs, and teaching something is
  // exactly what makes detection re-run.
  useEffect(() => {
    setTaught(null);
    setSpot(null);
    setBox(null);
    dragRef.current = null;
  }, [page.index]);

  // A box is read from the page's text, so a page with no text at all has
  // nothing a box could find. A scan often does have text - the scanner's own
  // reading of it, or a few words typed on top - and a box is worth a try there.
  const canPoint = Boolean(page.layout?.length && page.pageWidth && page.pageHeight);

  /* ------------------------------------------------ drawing a box, like a snip */

  /** Where the pointer is, as a fraction of the drawn page, top-left origin. */
  const pointOn = (event, rect) => ({
    x: clamp((event.clientX - rect.left) / rect.width),
    y: clamp((event.clientY - rect.top) / rect.height),
  });

  const boxFrom = (start, end) => ({
    left: Math.min(start.x, end.x),
    right: Math.max(start.x, end.x),
    top: Math.min(start.y, end.y),
    bottom: Math.max(start.y, end.y),
  });

  const startBox = (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const start = pointOn(event, rect);
    dragRef.current = { start, rect };
    setSpot(null);
    setTaught(null);
    setBox(boxFrom(start, start));
  };

  const growBox = (event) => {
    const drag = dragRef.current;
    if (!drag) return;
    setBox(boxFrom(drag.start, pointOn(event, drag.rect)));
  };

  /**
   * The box is finished: read what is inside it, the way every other page from
   * this client will be read, and show that before anything is saved.
   */
  const finishBox = (event) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    const drawn = boxFrom(drag.start, pointOn(event, drag.rect));
    const wide = (drawn.right - drawn.left) * drag.rect.width;
    const tall = (drawn.bottom - drawn.top) * drag.rect.height;
    if (wide < MIN_BOX || tall < MIN_BOX) {
      setBox(null);
      return;
    }
    setBox(drawn);

    // Screens measure down from the top; PDFs, and saved spots, up from the bottom.
    const zone = { x0: drawn.left, x1: drawn.right, y0: 1 - drawn.bottom, y1: 1 - drawn.top };
    const value = detectInZone(page.text, page.layout, zone, {
      width: page.pageWidth,
      height: page.pageHeight,
    });
    setSpot({ zone, value });
  };

  const cancelBox = () => {
    dragRef.current = null;
    setBox(null);
  };

  const stopPicking = () => {
    setPicking(false);
    setBox(null);
    setSpot(null);
  };

  const saveSpot = () => {
    onTeachZone(spot.zone, page, valueShape(spot.value), spot.value);
    setTaught({ kind: 'zone', text: spot.value });
    stopPicking();
  };

  // Arrow keys step through pages. Escape and the focus trap are handled by
  // useDialog, which every dialog in this app shares.
  useEffect(() => {
    const onKey = (event) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target?.tagName)) return;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') onStep(1);
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') onStep(-1);
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onStep]);

  if (!page) return null;

  // The client this page is remembered as, if its letterhead has been seen
  // before; otherwise the box is kept for a new one named after that letterhead.
  const client = page.matchedProfiles?.[0] ?? null;
  const clientName =
    client?.name ||
    newClientName ||
    (page.text ?? '').split('\n')[0].trim().slice(0, 60) ||
    'this client';

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
                  {group.provenance?.source === 'zone' ? (
                    <>, read from the box drawn for {group.provenance.label}</>
                  ) : (
                    group.provenance?.label && (
                      <>
                        , found after <code>{group.provenance.label}</code>
                      </>
                    )
                  )}
                </>
              ) : (
                'No invoice number was found on this page.'
              )}
              {client && !picking && (
                <>
                  {' '}
                  <button
                    type="button"
                    className="link-button"
                    data-testid="forget-box"
                    onClick={() => onForgetBox(client.id)}
                  >
                    Forget this client&rsquo;s box
                  </button>
                </>
              )}
            </p>
          </div>
          <div className="modal-tools">
            {!picking && canPoint && (
              <button
                type="button"
                className="button quiet"
                data-testid="point-start"
                onClick={() => {
                  setTaught(null);
                  setPicking(true);
                }}
              >
                {client ? 'Draw the box again' : 'Point to the invoice number'}
              </button>
            )}
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

        {onMoveToNeighbour && (canMoveBack || canMoveOn) && !picking && (
          <div className="modal-move">
            <span>This page belongs to a different invoice?</span>
            {/* A page with no neighbour on one side has nowhere to go that way,
                so that link is not offered at all rather than named after a
                page that does not exist. */}
            {canMoveBack && (
              <button
                type="button"
                className="link-button"
                data-testid="move-back"
                onClick={() => onMoveToNeighbour(-1)}
              >
                Move it to the invoice on page {page.index - 1}
              </button>
            )}
            {canMoveOn && (
              <button
                type="button"
                className="link-button"
                data-testid="move-on"
                onClick={() => onMoveToNeighbour(1)}
              >
                Move it to the invoice on page {page.index + 1}
              </button>
            )}
          </div>
        )}

        {picking && !spot && (
          <div className="teach point-banner" role="status" data-testid="point-banner">
            <span>
              {canPoint ? (
                <>
                  <strong>Drag a box around the invoice number</strong>, like taking a screenshot.
                  Every page from this client is then read from inside that box.
                </>
              ) : (
                <>
                  This page is a scan with no text on it yet, so a box would find nothing. Close
                  this, choose &ldquo;Read scanned pages&rdquo;, and point to the number after.
                </>
              )}
            </span>
            <button type="button" className="link-button" onClick={stopPicking}>
              Cancel
            </button>
          </div>
        )}

        {spot && (
          <div className="teach" data-testid="spot-bar">
            {spot.value ? (
              <>
                <span>
                  Inside the box: <strong data-testid="spot-value">{spot.value}</strong>. Read the
                  invoice number from here on every page from{' '}
                  <strong data-testid="spot-client">{clientName}</strong>.
                </span>
                <button type="button" className="button" data-testid="spot-save" onClick={saveSpot}>
                  Save this spot
                </button>
              </>
            ) : (
              <span data-testid="spot-empty">
                {unreadScan ? (
                  <>
                    There is no text inside that box to read. This page is a scan, and its words
                    have not been read yet: close this, choose &ldquo;Read scanned pages&rdquo;, and
                    draw the box again after.
                  </>
                ) : (
                  'There is no invoice number inside that box. Drag again, around just the number.'
                )}
              </span>
            )}
            <button
              type="button"
              className="link-button"
              onClick={() => {
                setSpot(null);
                setBox(null);
              }}
            >
              Draw again
            </button>
            <button type="button" className="link-button" onClick={stopPicking}>
              Cancel
            </button>
          </div>
        )}

        {taught && (
          <div className="teach teach-done" role="status" data-testid="teach-result">
            <>
              <span>
                {group?.provenance?.source === 'zone' ? (
                  <>
                    Found <strong>{group.invoice}</strong> in that spot.{' '}
                    {spotInvoices === 1
                      ? 'One invoice in this batch takes its number from a saved spot.'
                      : `${spotInvoices} invoices in this batch take their number from a saved spot.`}{' '}
                    Pages with nothing there stay with the invoice before them.
                  </>
                ) : (
                  <>
                    That spot was saved, but nothing was read from it on this page. Check the box,
                    or correct the number in the table.
                  </>
                )}
              </span>
              <button type="button" className="button quiet" onClick={onClose}>
                Done
              </button>
            </>
          </div>
        )}

        <div className="modal-body">
          <div className="page-view">
            <div className="page-sheet">
              <canvas ref={canvasRef} className="page-canvas" />
              <div ref={textRef} className="textLayer" />
              {picking && canPoint && (
                <div
                  className={`spot-picker${box ? ' has-box' : ''}`}
                  data-testid="spot-picker"
                  aria-hidden="true"
                  onPointerDown={startBox}
                  onPointerMove={growBox}
                  onPointerUp={finishBox}
                  onPointerCancel={cancelBox}
                >
                  {box && (
                    <div
                      className="spot-box"
                      data-testid="spot-box"
                      style={{
                        left: `${box.left * 100}%`,
                        top: `${box.top * 100}%`,
                        width: `${(box.right - box.left) * 100}%`,
                        height: `${(box.bottom - box.top) * 100}%`,
                      }}
                    />
                  )}
                </div>
              )}
              {drawing && <p className="page-drawing">Drawing the page&hellip;</p>}
            </div>
          </div>

          <aside className="text-panel">
            <h3>Text found on this page</h3>
            {page.text ? (
              // Focusable because it scrolls: a keyboard user needs to be able
              // to reach it in order to scroll it.
              <pre data-testid="page-text" tabIndex={0}>
                {page.text}
              </pre>
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
