import { useState } from 'react';
import { SUMMARY_STATUS } from '../../core/summary.js';

/** The slices of what is owed, in the order they sort: what needs chasing first. */
const SLICES = ['overdue', 'soon', 'open', 'unknown'];

const SIZE = 148;
const STROKE = 18;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCLE = 2 * Math.PI * RADIUS;
/** Surface left between two slices, along the ring. */
const GAP = 2;

const plural = (count) => (count === 1 ? '1 invoice' : `${count} invoices`);

/**
 * What one currency's unpaid invoices add up to, split by status: a ring with
 * the total in its middle, and a legend that says every amount in words.
 *
 * Pointing at a slice or a legend row puts its amount in the middle; choosing
 * one lists only those invoices in the table below.
 */
export function StatusDonut({ sum, money, active, onPick }) {
  const [hover, setHover] = useState(null);
  const shown = SLICES.filter((status) => sum.byStatus[status].amount > 0);

  let offset = 0;
  const slices = shown.map((status) => {
    const length = (sum.byStatus[status].amount / sum.outstanding) * CIRCLE;
    const slice = {
      status,
      length: shown.length > 1 ? Math.max(length - GAP, 0.5) : length,
      offset,
    };
    offset += length;
    return slice;
  });

  const focus = hover ?? (active !== 'all' && shown.includes(active) ? active : null);
  const pick = (status) => onPick(active === status ? 'all' : status);

  return (
    <div className="donut-wrap">
      <div className="donut">
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true">
          {slices.map((slice) => (
            <circle
              key={slice.status}
              className={`donut-slice status-${slice.status}${focus && focus !== slice.status ? ' is-dim' : ''}`}
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              strokeWidth={STROKE}
              strokeDasharray={`${slice.length} ${CIRCLE}`}
              strokeDashoffset={-slice.offset}
              transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
              onMouseEnter={() => setHover(slice.status)}
              onMouseLeave={() => setHover(null)}
              onClick={() => pick(slice.status)}
            />
          ))}
        </svg>
        <div className="donut-center" aria-live="polite">
          <strong>{money(focus ? sum.byStatus[focus].amount : sum.outstanding)}</strong>
          <span>{focus ? SUMMARY_STATUS[focus] : 'Outstanding'}</span>
        </div>
      </div>
      <ul className="donut-legend">
        {shown.map((status) => {
          const { amount, count } = sum.byStatus[status];
          return (
            <li key={status}>
              <button
                type="button"
                aria-pressed={active === status}
                onClick={() => pick(status)}
                onMouseEnter={() => setHover(status)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(status)}
                onBlur={() => setHover(null)}
                data-testid={`donut-${status}`}
              >
                <span className={`status-dot status-${status}`} />
                <span className="donut-legend-label">{SUMMARY_STATUS[status]}</span>
                <strong>{money(amount)}</strong>
                <small>
                  {plural(count)} · {Math.round((amount / sum.outstanding) * 100)}%
                </small>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * When the unpaid money falls due: how late on the left of today, how soon on
 * the right. One axis, amounts only; the tallest column says its amount, and
 * every column says its own on hover or focus.
 */
export function DueChart({ buckets, money }) {
  const [hover, setHover] = useState(null);
  const highest = Math.max(...buckets.map((bucket) => bucket.amount));
  if (highest <= 0) return null;
  const tallest = buckets.find((bucket) => bucket.amount === highest).key;
  const firstUpcoming = buckets.findIndex((bucket) => bucket.status !== 'overdue');

  return (
    <figure className="due-chart">
      <figcaption>When it falls due</figcaption>
      <div className="due-plot" role="list">
        {buckets.map((bucket, position) => {
          const height = bucket.amount > 0 ? Math.max((bucket.amount / highest) * 100, 2) : 0;
          const showing = hover === bucket.key;
          return [
            position === firstUpcoming && (
              <div className="due-today" key="today" aria-hidden="true">
                <span>Today</span>
              </div>
            ),
            <div
              key={bucket.key}
              className={`due-col${hover && !showing ? ' is-dim' : ''}`}
              role="listitem"
              tabIndex={0}
              aria-label={`${bucket.label}: ${money(bucket.amount)}, ${plural(bucket.count)}`}
              onMouseEnter={() => setHover(bucket.key)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(bucket.key)}
              onBlur={() => setHover(null)}
              data-testid={`due-${bucket.key}`}
            >
              <div className="due-area">
                {showing ? (
                  <span className="chart-tip" role="tooltip">
                    <strong>{money(bucket.amount)}</strong>
                    {plural(bucket.count)}
                  </span>
                ) : (
                  bucket.key === tallest && (
                    <span className="due-value">{money(bucket.amount)}</span>
                  )
                )}
                <div
                  className={`due-bar status-${bucket.status}`}
                  style={{ height: `${height}%` }}
                />
              </div>
              <span className="due-label">{bucket.label}</span>
            </div>,
          ];
        })}
      </div>
    </figure>
  );
}
