import { useEffect, useRef, useState } from 'react';
import { TextLayer } from '../../lib/pdfjs.js';
import { labelFromSelection } from '../../core/profiles.js';
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
 * Two ways to teach the app from here. Highlighting words with the text cursor
 * offers them as a label. And "Point to the invoice number" turns the page into
 * something like a screenshot tool: drag a box around the number, and every page
 * from that client is read from inside that box from then on.
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
  profiles,
  onTeachLabel,
  onTeachZone,
  pointing = false,
  spotInvoices = 0,
  busy,
}) {
  const canvasRef = useRef(null);
  const textRef = useRef(null);
  const dragRef = useRef(null);
  const dialogRef = useDialog({ onClose });
  const [drawing, setDrawing] = useState(true);
  const [taught, setTaught] = useState(null);
  const [teaching, setTeaching] = useState(null);
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
    setTeaching(null);
    setTaught(null);
    setSpot(null);
    setBox(null);
    dragRef.current = null;
  }, [page.index]);

  // A page with no text layer - a scan - has nothing a box could be read from.
  const canPoint = Boolean(page.layout?.length && page.pageWidth && page.pageHeight);

  /**
   * Somebody dragged across the words on the page with the text cursor. What
   * they highlighted is usually the label and the number together, so the
   * number is dropped and the words in front of it are offered as a label.
   */
  const readSelection = () => {
    if (picking) return;
    const label = labelFromSelection(window.getSelection?.()?.toString() ?? '');
    if (label) setTeaching({ label, profileId: profiles?.[0]?.id ?? 'new' });
  };

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
    setSpot({
      zone,
      value,
      // The client this page already belongs to, if any; otherwise a new one,
      // so a spot is never put on some other client's profile by default.
      profileId: page.matchedProfiles?.[0]?.id ?? 'new',
    });
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
    onTeachZone(spot.zone, spot.profileId, page, valueShape(spot.value));
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

  /** Which client to teach: the same choice for a label and for a spot. */
  const profileChoice = (value, onChange) => (
    <label>
      <span className="visually-hidden">Client profile</span>
      <select
        value={value}
        data-testid="teach-profile"
        onChange={(event) => onChange(event.target.value)}
      >
        {(profiles ?? []).map((profile) => (
          <option key={profile.id} value={profile.id}>
            {profile.name}
          </option>
        ))}
        <option value="new">A new profile&hellip;</option>
      </select>
    </label>
  );

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
                    <>, read from the spot you chose</>
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
            </p>
          </div>
          <div className="modal-tools">
            {!picking && canPoint && (
              <button
                type="button"
                className="button quiet"
                data-testid="point-start"
                onClick={() => {
                  setTeaching(null);
                  setTaught(null);
                  setPicking(true);
                }}
              >
                Point to the invoice number
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
                  This page has no text on it to read, so a box would find nothing. Step to a page
                  that is not a scan.
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
                  invoice number from here for
                </span>
                {profileChoice(spot.profileId, (profileId) =>
                  setSpot((current) => ({ ...current, profileId }))
                )}
                <button type="button" className="button" data-testid="spot-save" onClick={saveSpot}>
                  Save this spot
                </button>
              </>
            ) : (
              <span data-testid="spot-empty">
                There is no invoice number inside that box. Drag again, around just the number.
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

        {teaching && (
          <div className="teach" data-testid="teach-bar">
            <span>
              Teach <strong data-testid="teach-label">{teaching.label}</strong> to
            </span>
            {profileChoice(teaching.profileId, (profileId) =>
              setTeaching((current) => ({ ...current, profileId }))
            )}
            <button
              type="button"
              className="button"
              data-testid="teach-add"
              onClick={() => {
                onTeachLabel(teaching.label, teaching.profileId, page);
                setTaught({ kind: 'label', text: teaching.label });
                setTeaching(null);
                window.getSelection?.()?.removeAllRanges();
              }}
            >
              Add as label
            </button>
            <button type="button" className="link-button" onClick={() => setTeaching(null)}>
              Not now
            </button>
          </div>
        )}

        {taught && (
          <div className="teach teach-done" role="status" data-testid="teach-result">
            {taught.kind === 'zone' ? (
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
            ) : group?.invoice && group.provenance?.source === 'profile' ? (
              <span>
                Found <strong>{group.invoice}</strong> after <code>{group.provenance.label}</code>.
                Every page with that label is read the same way now.
              </span>
            ) : (
              <span>
                <code>{taught.text}</code> was added, but no number was found after it on this page.
                Check the highlight, or correct the number in the table.
              </span>
            )}
          </div>
        )}

        <div className="modal-body">
          <div className="page-view">
            <div className="page-sheet" onMouseUp={readSelection} onTouchEnd={readSelection}>
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
