import { useEffect, useRef, useState } from 'react';
import { tileClass } from '../colors.js';
import { pageThumbnail } from '../../lib/thumbnails.js';

/** How wide the hover panel is, in pixels. Kept in step with styles.css. */
const PEEK_WIDTH = 240;

/**
 * The whole batch, at a glance.
 *
 * One tile per page, coloured by invoice, with a gap wherever a new invoice
 * starts. A page carried over from the invoice before it is striped, and a page
 * nothing could be worked out about is marker yellow. Hovering shows the page
 * itself, so a person can check a split without opening anything.
 */
export default function PageStrip({ groups, onOpenPage, docsById, matchedPages }) {
  const [hovered, setHovered] = useState(null);
  const wrap = useRef(null);

  /** Remember which tile the pointer is on, and where that tile sits. */
  const peekAt = (page, group) => (event) => {
    const tile = event.currentTarget;
    const width = wrap.current?.clientWidth ?? 0;
    // Line the panel up under its tile, without letting it run off either edge.
    const left = Math.max(0, Math.min(tile.offsetLeft - 8, width - PEEK_WIDTH));
    setHovered({ page, group, left });
  };

  if (groups.length === 0) return null;

  return (
    <div className="strip-wrap" ref={wrap}>
      <ol className="strip" data-testid="page-strip" onMouseLeave={() => setHovered(null)}>
        {groups.map((group, groupIndex) =>
          group.pages.map((page, positionInGroup) => {
            const isContinuation = group.continuationPages.includes(page.index);
            const dimmed = matchedPages !== null && !matchedPages.has(page.index);
            const classes = [
              'tile',
              tileClass(groupIndex),
              positionInGroup === 0 ? 'tile-starts' : '',
              isContinuation ? 'tile-continuation' : '',
              group.invoice ? '' : 'tile-aside',
              dimmed ? 'tile-dimmed' : '',
            ]
              .filter(Boolean)
              .join(' ');

            return (
              <li key={page.index} className="tile-slot">
                <button
                  type="button"
                  className={classes}
                  data-testid={`tile-${page.index}`}
                  aria-label={`Page ${page.index}, ${
                    group.invoice ? `invoice ${group.invoice}` : 'no invoice number'
                  }`}
                  onMouseEnter={peekAt(page, group)}
                  onFocus={peekAt(page, group)}
                  onBlur={() => setHovered(null)}
                  onClick={() => onOpenPage(page.index)}
                >
                  <span className="tile-number">{page.index}</span>
                </button>
              </li>
            );
          })
        )}
      </ol>

      {hovered && (
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
