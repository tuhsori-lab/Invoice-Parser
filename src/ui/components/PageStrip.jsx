import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
 *
 * A thousand-page batch is a thousand tiles, so each tile is a memoised
 * component taking only plain values and one set of handlers that never
 * changes. Hovering a tile then redraws that tile, not the whole strip.
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

  // Tiles read in page order: the strip is a picture of the file, not of the
  // grouping, so an invoice whose pages are not next to each other simply shows
  // its colour twice.
  const { colourOf, groupOf, ordered } = useMemo(() => {
    const colours = new Map();
    const owners = new Map();
    groups.forEach((group, position) => {
      colours.set(group.id, position);
      for (const page of group.pages) owners.set(page.index, group);
    });
    return {
      colourOf: colours,
      groupOf: owners,
      ordered: [...owners.keys()].sort((a, b) => a - b),
    };
  }, [groups]);

  // What the handlers need to know, without having to be rebuilt to know it.
  const live = useRef({ groupOf, dragging });
  live.current = { groupOf, dragging };

  const handlers = useMemo(
    () => ({
      peek(event, pageIndex) {
        const group = live.current.groupOf.get(pageIndex);
        const page = group?.pages.find((entry) => entry.index === pageIndex);
        if (!page) return;
        const tile = event.currentTarget;
        const width = wrap.current?.clientWidth ?? 0;
        // Line the panel up under its tile, without running off either edge.
        const left = Math.max(0, Math.min(tile.offsetLeft - 8, width - PEEK_WIDTH));
        setHovered({ page, group, left });
      },
      leave() {
        setHovered(null);
      },
      open(pageIndex) {
        onOpenPage(pageIndex);
      },
      gap(pageIndex, startsInvoice) {
        if (startsInvoice) onJoin(pageIndex);
        else onSplit(pageIndex);
      },
      dragStart(event, pageIndex) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', String(pageIndex));
        setDragging(pageIndex);
        setHovered(null);
      },
      dragEnd() {
        setDragging(null);
        setDropTarget(null);
      },
      dragOver(event, pageIndex) {
        const held = live.current.dragging;
        if (held === null || held === pageIndex) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        setDropTarget(pageIndex);
      },
      dragLeave(pageIndex) {
        setDropTarget((current) => (current === pageIndex ? null : current));
      },
      drop(event, pageIndex) {
        event.preventDefault();
        const moved = Number(event.dataTransfer.getData('text/plain'));
        setDragging(null);
        setDropTarget(null);
        if (Number.isFinite(moved) && moved !== pageIndex) onMovePage(moved, pageIndex);
      },
    }),
    [onOpenPage, onJoin, onSplit, onMovePage]
  );

  const clearHover = useCallback(() => setHovered(null), []);

  if (groups.length === 0) return null;

  return (
    <div className="strip-wrap" ref={wrap}>
      <ol className="strip" data-testid="page-strip" onMouseLeave={clearHover}>
        {ordered.map((pageIndex, position) => {
          const group = groupOf.get(pageIndex);
          const startsInvoice = position === 0 || groupOf.get(ordered[position - 1]) !== group;

          return (
            <Tile
              key={pageIndex}
              pageIndex={pageIndex}
              handlers={handlers}
              startsInvoice={startsInvoice}
              showGap={position > 0}
              manualBoundary={Boolean(boundaries[pageIndex])}
              continuation={group.continuationPages.includes(pageIndex)}
              moved={group.movedPages.includes(pageIndex)}
              aside={!group.invoice}
              dimmed={matchedPages !== null && !matchedPages.has(pageIndex)}
              dragging={dragging === pageIndex}
              dropping={dropTarget === pageIndex}
              colour={tileClass(colourOf.get(group.id))}
              invoice={group.invoice}
            />
          );
        })}
      </ol>

      {hovered && dragging === null && (
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

/** One page, and the gap in front of it. */
const Tile = memo(function Tile({
  pageIndex,
  handlers,
  startsInvoice,
  showGap,
  manualBoundary,
  continuation,
  moved,
  aside,
  dimmed,
  dragging,
  dropping,
  colour,
  invoice,
}) {
  const classes = [
    'tile',
    colour,
    startsInvoice ? 'tile-starts' : '',
    continuation ? 'tile-continuation' : '',
    aside ? 'tile-aside' : '',
    moved ? 'tile-moved' : '',
    dimmed ? 'tile-dimmed' : '',
    dropping ? 'tile-drop' : '',
    dragging ? 'tile-dragging' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const gapLabel = startsInvoice
    ? `Join page ${pageIndex} to the invoice before it`
    : `Start a new invoice at page ${pageIndex}`;

  return (
    <li className="tile-slot">
      {showGap && (
        <button
          type="button"
          className={`gap${startsInvoice ? ' gap-open' : ''}${manualBoundary ? ' gap-manual' : ''}`}
          data-testid={`gap-${pageIndex}`}
          title={gapLabel}
          aria-label={gapLabel}
          onClick={() => handlers.gap(pageIndex, startsInvoice)}
        >
          <span className="gap-mark" aria-hidden="true" />
        </button>
      )}

      <button
        type="button"
        className={classes}
        data-testid={`tile-${pageIndex}`}
        draggable
        aria-label={`Page ${pageIndex}, ${invoice ? `invoice ${invoice}` : 'no invoice number'}`}
        onMouseEnter={(event) => handlers.peek(event, pageIndex)}
        onFocus={(event) => handlers.peek(event, pageIndex)}
        onBlur={handlers.leave}
        onClick={() => handlers.open(pageIndex)}
        onDragStart={(event) => handlers.dragStart(event, pageIndex)}
        onDragEnd={handlers.dragEnd}
        onDragOver={(event) => handlers.dragOver(event, pageIndex)}
        onDragLeave={() => handlers.dragLeave(pageIndex)}
        onDrop={(event) => handlers.drop(event, pageIndex)}
      >
        <span className="tile-number">{pageIndex}</span>
      </button>
    </li>
  );
});

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
