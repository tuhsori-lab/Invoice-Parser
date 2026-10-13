/**
 * How far along something is: a sentence, a bar, the percentage, and a way to
 * stop. When the total is not known yet, the bar sweeps instead of guessing.
 */
export default function ProgressBar({
  label,
  done = 0,
  total = 0,
  onCancel,
  cancelLabel = 'Cancel',
  cancelTestId,
  testId,
}) {
  const known = total > 0;
  const percent = known ? Math.min(100, Math.round((done / total) * 100)) : null;
  return (
    <div className="progress" role="status" data-testid={testId}>
      <div className="progress-head">
        <p>{label}</p>
        {known && <span className="progress-percent">{percent}%</span>}
        {onCancel && (
          <button
            type="button"
            className="button quiet"
            onClick={onCancel}
            data-testid={cancelTestId}
          >
            {cancelLabel}
          </button>
        )}
      </div>
      <div
        className={`progress-track${known ? '' : ' is-unknown'}`}
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={known ? total : undefined}
        aria-valuenow={known ? done : undefined}
      >
        <div className="progress-bar" style={known ? { width: `${percent}%` } : undefined} />
      </div>
    </div>
  );
}
