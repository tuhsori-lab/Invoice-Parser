import { useEffect, useRef } from 'react';

/**
 * A question asked before something that cannot be taken back.
 *
 * Used when a person exports while invoices still need a look: they may know
 * exactly what they are doing, so this says how many are left and gets out of
 * the way rather than blocking.
 */
export default function ConfirmDialog({ question, detail, confirmLabel, onConfirm, onCancel }) {
  const dialog = useRef(null);

  useEffect(() => {
    dialog.current?.focus();
    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div
        className="confirm"
        role="dialog"
        aria-modal="true"
        aria-label={question}
        tabIndex={-1}
        ref={dialog}
        data-testid="confirm-dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="confirm-question">{question}</p>
        {detail && <p className="confirm-detail">{detail}</p>}
        <div className="confirm-buttons">
          <button type="button" className="button quiet" onClick={onCancel}>
            Go back and check
          </button>
          <button type="button" className="button" onClick={onConfirm} data-testid="confirm-export">
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
