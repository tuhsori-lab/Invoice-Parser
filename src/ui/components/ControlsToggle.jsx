/**
 * The one button between the invoices and every setting that shapes them.
 *
 * Most batches split correctly as they are, and a sidebar of radio buttons and
 * patterns is more than most people want to read before getting on with it. So
 * the settings sit behind this, closed until somebody asks for them. A setting
 * changed and then put away is never out of mind: the button says how many
 * are not as they started.
 */
export default function ControlsToggle({ open, onToggle, changed = 0 }) {
  return (
    <div className="controls-bar">
      <button
        type="button"
        className="controls-toggle"
        aria-expanded={open}
        aria-controls="advanced-controls"
        data-testid="advanced-toggle"
        onClick={onToggle}
      >
        Advanced controls
      </button>
      {changed > 0 ? (
        <span className="controls-changed" data-testid="controls-changed">
          {changed === 1 ? '1 setting changed' : `${changed} settings changed`}
        </span>
      ) : (
        !open && (
          <span className="controls-hint">
            How pages are split, how the number is found, and what files are called. Most batches
            need none of these.
          </span>
        )
      )}
    </div>
  );
}
