import { useEffect, useRef, useState } from 'react';
import { TextLayer } from '../../lib/pdfjs.js';
import { labelFromSelection } from '../../core/profiles.js';
import { useDialog } from '../../lib/useDialog.js';

/** How wide the rendered page is drawn, in CSS pixels. */
const PAGE_WIDTH = 660;

/**
 * Where on the page somebody dragged, as fractions of the page's own size.
 *
 * The text layer is drawn exactly over the page, so the highlight's box
 * measured against that layer is already the fraction of the page wanted - at
 * whatever size the dialog happens to draw it, and whatever size the page is.
 * Screens measure downwards from the top and PDFs measure upwards from the
 * bottom, so the vertical pair is turned over on the way out.
 *
 * @param {Selection|null} selection
 * @param {HTMLElement|null} layer - the text layer over the drawn page.
 * @returns {{ x0: number, y0: number, x1: number, y1: number }|null}
 */
function zoneFromSelection(selection, layer) {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  if (!layer || !layer.contains(selection.anchorNode)) return null;

  const box = selection.getRangeAt(0).getBoundingClientRect();
  const sheet = layer.getBoundingClientRect();
  if (!box.width || !box.height || !sheet.width || !sheet.height) return null;

  return {
    x0: (box.left - sheet.left) / sheet.width,
    x1: (box.right - sheet.left) / sheet.width,
    y0: 1 - (box.bottom - sheet.top) / sheet.height,
    y1: 1 - (box.top - sheet.top) / sheet.height,
  };
}

/**
 * One page, big enough to read, with the text pdf.js found sitting invisibly on
 * top of it. The text layer is what makes the page selectable now, and what
 * teaching a label by highlighting will use later.
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
  busy,
}) {
  const canvasRef = useRef(null);
  const textRef = useRef(null);
  const dialogRef = useDialog({ onClose });
  const [drawing, setDrawing] = useState(true);
  const [taught, setTaught] = useState(null);
  const [teaching, setTeaching] = useState(null);

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
  // object is rebuilt every time detection re-runs, and teaching a label is
  // exactly what makes detection re-run.
  useEffect(() => {
    setTeaching(null);
    setTaught(null);
  }, [page.index]);

  /**
   * Somebody dragged across the page, and there are two things worth learning
   * from that.
   *
   * What they highlighted is usually the label and the number together, so the
   * number is dropped and the words in front of it are offered as a label. And
   * wherever they dragged is offered as a spot: on a client whose wording is
   * unusable - text drawn over other text, a heading that is really a picture -
   * the number is still printed in the same place on every invoice, and being
   * shown that place once is enough.
   */
  const readSelection = () => {
    const selection = window.getSelection?.() ?? null;
    const label = labelFromSelection(selection?.toString() ?? '');
    const zone = zoneFromSelection(selection, textRef.current);
    if (label || zone) setTeaching({ label, zone, profileId: profiles?.[0]?.id ?? 'new' });
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

        {onMoveToNeighbour && (canMoveBack || canMoveOn) && (
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

        {teaching && (
          <div className="teach" data-testid="teach-bar">
            <span>
              {teaching.label ? (
                <>
                  Teach <strong data-testid="teach-label">{teaching.label}</strong> to
                </>
              ) : (
                <>Teach this spot on the page to</>
              )}
            </span>
            <label>
              <span className="visually-hidden">Client profile</span>
              <select
                value={teaching.profileId}
                data-testid="teach-profile"
                onChange={(event) =>
                  setTeaching((current) => ({ ...current, profileId: event.target.value }))
                }
              >
                {(profiles ?? []).map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name}
                  </option>
                ))}
                <option value="new">A new profile&hellip;</option>
              </select>
            </label>
            {teaching.label && (
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
            )}
            {teaching.zone && (
              <button
                type="button"
                className="button"
                data-testid="teach-spot"
                title="Read this same place on every page from this client"
                onClick={() => {
                  onTeachZone(teaching.zone, teaching.profileId, page);
                  setTaught({ kind: 'zone', text: '' });
                  setTeaching(null);
                  window.getSelection?.()?.removeAllRanges();
                }}
              >
                Use this spot
              </button>
            )}
            <button type="button" className="link-button" onClick={() => setTeaching(null)}>
              Not now
            </button>
          </div>
        )}

        {taught && (
          <div className="teach teach-done" role="status" data-testid="teach-result">
            {group?.invoice &&
            group.provenance?.source === (taught.kind === 'zone' ? 'zone' : 'profile') ? (
              <span>
                Found <strong>{group.invoice}</strong>{' '}
                {taught.kind === 'zone' ? (
                  <>
                    at that spot. Every page from this client is read from there now, whatever the
                    wording around it does.
                  </>
                ) : (
                  <>
                    after <code>{group.provenance.label}</code>. Every page with that label is read
                    the same way now.
                  </>
                )}
              </span>
            ) : (
              <span>
                {taught.kind === 'zone' ? (
                  <>
                    That spot was saved, but nothing shaped like a number was found there on this
                    page. Check the highlight, or correct the number in the table.
                  </>
                ) : (
                  <>
                    <code>{taught.text}</code> was added, but no number was found after it on this
                    page. Check the highlight, or correct the number in the table.
                  </>
                )}
              </span>
            )}
          </div>
        )}

        <div className="modal-body">
          <div className="page-view">
            <div className="page-sheet" onMouseUp={readSelection} onTouchEnd={readSelection}>
              <canvas ref={canvasRef} className="page-canvas" />
              <div ref={textRef} className="textLayer" />
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
