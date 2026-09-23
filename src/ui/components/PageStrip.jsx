import { useEffect, useRef, useState } from 'react';
import { tileClass } from '../colors.js';
import { pageThumbnail } from '../../lib/thumbnails.js';

/** How wide the hover panel is, in pixels. Kept in step with styles.css. */
const PEEK_WIDTH = 240;

/**
 * The whole batch, at a glance, and the quickest way to fix it.
 *
 * Tiles run in page order, coloured by invoice, with a gap wherever one invoice
 * ends and the next begins. A page carried over from the invoice before it is
 * striped; a page nothing could be worked out about is marker yellow. Anything
 * a person changed by hand carries a small mark, so a fix is never invisible.
 *
 * The gaps are buttons: clicking one splits the invoice there, or joins it back
 * to the one before. Tiles can be dragged onto another invoice to move a page.
 */
export default function PageStrip({
  groups,
  onOpenPage,
  docsById,
  matchedPages,
  onSplit,
  onJoin,
  onMovePage,
  boundaries = {},
}) {
  const [hovered, setHovered] = useState(null);
  const [dragging, setDragging] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);
  const wrap = useRef(null);

  if (groups.length === 0) return null;

  // Tiles read in page order: the strip is a picture of the file, not of the
  // grouping, so an invoice whose pages are not next to each other simply shows
  // its colour twice.
  const colourOf = new Map();
  const groupOf = new Map();
  groups.forEach((group, position) => {
    colourOf.set(group.id, position);
    for (const page of group.pages) groupOf.set(page.index, group);
  });
  const ordered = [...groupOf.keys()].sort((a, b) => a - b);

  /** Remember which tile the pointer is on, and where that tile sits. */
  const peekAt = (page, group) => (event) => {
    const tile = event.currentTarget;
    const width = wrap.current?.clientWidth ?? 0;
    // Line the panel up under its tile, without letting it run off either edge.
    const left = Math.max(0, Math.min(tile.offsetLeft - 8, width - PEEK_WIDTH));
    setHovered({ page, group, left });
  };

  return (
    <div className="strip-wrap" ref={wrap}>
      <ol className="strip" data-testid="page-strip" onMouseLeave={() => setHovered(null)}>
        {ordered.map((pageIndex, position) => {
          const group = groupOf.get(pageIndex);
          const page = group.pages.find((entry) => entry.index === pageIndex);
          const previous = position === 0 ? null : groupOf.get(ordered[position - 1]);
          const startsInvoice = previous !== group;
          const manualBoundary = boundaries[pageIndex];

          const classes = [
            'tile',
            tileClass(colourOf.get(group.id)),
            startsInvoice ? 'tile-starts' : '',
            group.continuationPages.includes(pageIndex) ? 'tile-continuation' : '',
            group.invoice ? '' : 'tile-aside',
            group.movedPages.includes(pageIndex) ? 'tile-moved' : '',
            matchedPages !== null && !matchedPages.has(pageIndex) ? 'tile-dimmed' : '',
            dropTarget === pageIndex ? 'tile-drop' : '',
            dragging === pageIndex ? 'tile-dragging' : '',
          ]
            .filter(Boolean)
            .join(' ');

          return (
            <li key={pageIndex} className="tile-slot">
              {position > 0 && (
                <button
                  type="button"
                  className={`gap${startsInvoice ? ' gap-open' : ''}${
                    manualBoundary ? ' gap-manual' : ''
                  }`}
                  data-testid={`gap-${pageIndex}`}
                  title={
                    startsInvoice
                      ? `Join page ${pageIndex} to the invoice before it`
                      : `Start a new invoice at page ${pageIndex}`
                  }
                  aria-label={
                    startsInvoice
                      ? `Join page ${pageIndex} to the invoice before it`
                      : `Start a new invoice at page ${pageIndex}`
                  }
                  onClick={() => (startsInvoice ? onJoin(pageIndex) : onSplit(pageIndex))}
                >
                  <span className="gap-mark" aria-hidden="true" />
                </button>
              )}

              <button
                type="button"
                className={classes}
                data-testid={`tile-${pageIndex}`}
                draggable
                aria-label={`Page ${pageIndex}, ${
                  group.invoice ? `invoice ${group.invoice}` : 'no invoice number'
                }`}
                onMouseEnter={peekAt(page, group)}
                onFocus={peekAt(page, group)}
                onBlur={() => setHovered(null)}
                onClick={() => onOpenPage(pageIndex)}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('text/plain', String(pageIndex));
                  setDragging(pageIndex);
                  setHovered(null);
                }}
                onDragEnd={() => {
                  setDragging(null);
                  setDropTarget(null);
                }}
                onDragOver={(event) => {
                  if (dragging === null || dragging === pageIndex) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                  setDropTarget(pageIndex);
                }}
                onDragLeave={() =>
                  setDropTarget((current) => (current === pageIndex ? null : current))
                }
                onDrop={(event) => {
                  event.preventDefault();
                  const moved = Number(event.dataTransfer.getData('text/plain'));
                  setDragging(null);
                  setDropTarget(null);
                  if (Number.isFinite(moved) && moved !== pageIndex) onMovePage(moved, pageIndex);
                }}
              >
                <span className="tile-number">{pageIndex}</span>
              </button>
            </li>
          );
        })}
      </ol>

      {hovered && !dragging && (
        <PagePeek
          page={hovered.page}
          group={hovered.group}
          doc={docsById.get(hovered.page.fileId)}
          left={hovered.left}
        />
      )}

      <p className="strip-key">
        <span className="key-item">
          <span className="key-swatch tile tile-c1" /> one invoice
        </span>
        <span className="key-item">
          <span className="key-swatch tile tile-c1 tile-continuation" /> carried over from the page
          before
        </span>
        <span className="key-item">
          <span className="key-swatch tile tile-aside" /> no invoice number
        </span>
        <span className="key-item">
          <span className="key-swatch tile tile-c1 tile-moved" /> changed by you
        </span>
        <span className="key-item key-hint">
          Click a gap to split or join. Drag a page onto another invoice to move it.
        </span>
      </p>
    </div>
  );
}

/** The little picture of a page that follows the pointer along the strip. */
function PagePeek({ page, group, doc, left }) {
  const [image, setImage] = useState(null);
  const current = useRef(null);

  useEffect(() => {
    if (!doc) return undefined;
    const token = {};
    current.current = token;
    setImage(null);
    pageThumbnail(page, doc)
      .then((url) => {
        if (current.current === token) setImage(url);
      })
      .catch(() => {
        // A page that will not draw simply shows no picture.
      });
    return () => {
      current.current = null;
    };
  }, [page, doc]);

  return (
    <div className="peek" role="presentation" style={{ left }}>
      <div className="peek-sheet">
        {image ? <img src={image} alt="" /> : <div className="peek-placeholder" />}
      </div>
      <div className="peek-caption">
        <strong>Page {page.index}</strong>
        <span>{group.invoice ? group.invoice : 'No invoice number'}</span>
      </div>
    </div>
  );
}
