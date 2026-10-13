import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { tileClass } from '../colors.js';
import { pageThumbnail } from '../../lib/thumbnails.js';

/** How wide the hover panel is, in pixels. Kept in step with styles.css. */
const PEEK_WIDTH = 240;

/**
 * The whole batch, at a glance, and the quickest way to fix it.
 *
 * Tiles run in page order, coloured by invoice, with a gap wherever one invoice
 * ends and the next begins, and a bracket over each invoice's pages naming it.
 * An invoice's first page is solid and every page after it is striped, so where
 * each invoice starts reads at a glance. An invoice nothing could be worked out
 * about is marker yellow. Anything a person changed by hand carries a small
 * mark, so a fix is never invisible.
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
  const { colourOf, groupOf, runs, firstPageOf } = useMemo(() => {
    const colours = new Map();
    const owners = new Map();
    const firsts = new Map();
    groups.forEach((group, position) => {
      colours.set(group.id, position);
      for (const page of group.pages) owners.set(page.index, group);
      firsts.set(group.id, Math.min(...group.pages.map((page) => page.index)));
    });
    const ordered = [...owners.keys()].sort((a, b) => a - b);

    // Unbroken stretches of one invoice's pages. Each gets a bracket of its own;
    // an invoice whose pages are apart gets one over each stretch.
    const stretches = [];
    for (const pageIndex of ordered) {
      const group = owners.get(pageIndex);
      const last = stretches[stretches.length - 1];
      if (last && last.group === group) last.pages.push(pageIndex);
      else stretches.push({ group, pages: [pageIndex] });
    }
    return { colourOf: colours, groupOf: owners, runs: stretches, firstPageOf: firsts };
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
        {runs.map((run, position) => {
          const { group } = run;
          const colour = tileClass(colourOf.get(group.id));
          const name = group.invoice ?? 'No number';
          const [opening] = run.pages;

          return (
            <li key={opening} className="strip-run">
              {/* Where one invoice ends and the next begins: outside the
                  brackets, so it is plain which side of it each page is on. */}
              {position > 0 && (
                <Gap
                  pageIndex={opening}
                  startsInvoice
                  manual={Boolean(boundaries[opening])}
                  handlers={handlers}
                />
              )}
              <div
                className={`run-body ${colour}${group.invoice ? '' : ' run-aside'}`}
                data-testid={`run-${opening}`}
              >
                {/* The tiles already say which invoice they belong to, for
                    anyone using a screen reader, so this is for the eye only. */}
                <span className="run-label" title={name} aria-hidden="true">
                  {name}
                </span>
                <span className="run-bracket" aria-hidden="true" />
                <ol className="run-tiles">
                  {run.pages.map((pageIndex, inRun) => (
                    <Tile
                      key={pageIndex}
                      pageIndex={pageIndex}
                      handlers={handlers}
                      startsInvoice={inRun === 0}
                      showGap={inRun > 0}
                      manualBoundary={Boolean(boundaries[pageIndex])}
                      continuation={pageIndex !== firstPageOf.get(group.id)}
                      moved={group.movedPages.includes(pageIndex)}
                      aside={!group.invoice}
                      dimmed={matchedPages !== null && !matchedPages.has(pageIndex)}
                      dragging={dragging === pageIndex}
                      dropping={dropTarget === pageIndex}
                      colour={colour}
                      invoice={group.invoice}
                    />
                  ))}
                </ol>
              </div>
            </li>
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
          <span className="key-swatch tile tile-c1" /> first page of an invoice
        </span>
        <span className="key-item">
          <span className="key-swatch tile tile-c1 tile-continuation" /> more pages of the same
          invoice
        </span>
        <span className="key-item">
          <span className="key-swatch tile tile-aside" /> no invoice number
        </span>
        <span className="key-item">
          <span className="key-swatch tile tile-c1 tile-moved" /> changed by you
        </span>
        <span className="key-item key-hint">
          The bracket above names each invoice. Click a gap to split or join. Drag a page onto
          another invoice to move it.
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

  return (
    <li className="tile-slot">
      {showGap && (
        <Gap
          pageIndex={pageIndex}
          startsInvoice={false}
          manual={manualBoundary}
          handlers={handlers}
        />
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

/**
 * The gap in front of a page: a button. Between two invoices it is open, and
 * clicking it joins the page to the invoice before; inside an invoice it is
 * closed, and clicking it starts a new invoice there.
 */
const Gap = memo(function Gap({ pageIndex, startsInvoice, manual, handlers }) {
  const label = startsInvoice
    ? `Join page ${pageIndex} to the invoice before it`
    : `Start a new invoice at page ${pageIndex}`;
  return (
    <button
      type="button"
      className={`gap${startsInvoice ? ' gap-open' : ''}${manual ? ' gap-manual' : ''}`}
      data-testid={`gap-${pageIndex}`}
      title={label}
      aria-label={label}
      onClick={() => handlers.gap(pageIndex, startsInvoice)}
    >
      <span className="gap-mark" aria-hidden="true" />
    </button>
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
