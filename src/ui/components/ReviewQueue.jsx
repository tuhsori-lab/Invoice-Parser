import { tileClass } from '../colors.js';

/**
 * Everything worth a person's eye before anything is exported.
 *
 * Each entry says what is wrong in a sentence and which pages it is about, and
 * opens the first of those pages. "Next issue" walks the list, so a batch can be
 * cleared without hunting through the table.
 */
export default function ReviewQueue({ items, colourOf, current, onGo, onOpenPage }) {
  if (items.length === 0) return null;

  return (
    <section className="review" aria-label="Needs a look" data-testid="review-queue">
      <header className="review-head">
        <h2>
          {items.length === 1 ? '1 invoice needs a look' : `${items.length} invoices need a look`}
        </h2>
        <button type="button" className="button quiet" onClick={onGo} data-testid="next-issue">
          Next issue <kbd>N</kbd>
        </button>
      </header>

      <ol className="review-list">
        {items.map((item, position) => (
          <li
            key={item.id}
            className={`review-item${position === current ? ' is-current' : ''}`}
            data-testid={`review-item-${item.id}`}
          >
            <span
              className={`swatch tile ${tileClass(colourOf.get(item.id) ?? 0)}`}
              aria-hidden="true"
            />
            <div className="review-text">
              {item.reasons.map((reason) => (
                <p key={reason}>{reason}</p>
              ))}
            </div>
            <button
              type="button"
              className="link-button"
              onClick={() => onOpenPage(item.group.pages[0].index)}
            >
              Open page {item.group.pages[0].index}
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
