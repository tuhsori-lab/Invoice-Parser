import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

/**
 * Short notes in the corner: a file saved, a list copied, something that went
 * wrong. They go away by themselves; one that reports a problem stays a little
 * longer, and any can be closed. Read out by screen readers as they appear.
 */

const ToastContext = createContext(() => {});

/** How long a note stays up, in milliseconds. */
const SHOWN_FOR = { success: 4500, info: 4500, error: 8000 };

/**
 * Show a note.
 *
 * @returns {(message: string, options?: { kind?: 'success'|'info'|'error', testId?: string }) => void}
 */
export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback((message, { kind = 'success', testId } = {}) => {
    const id = nextId.current;
    nextId.current += 1;
    // At most four at once: the oldest makes way.
    setToasts((current) => [...current.slice(-3), { id, message, kind, testId }]);
  }, []);

  const value = useMemo(() => show, [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts" role="region" aria-label="Notifications">
        {toasts.map((toast) => (
          <Toast key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function Toast({ toast, onDismiss }) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), SHOWN_FOR[toast.kind] ?? 4500);
    return () => clearTimeout(timer);
  }, [toast, onDismiss]);

  return (
    <div
      className={`toast is-${toast.kind}`}
      role={toast.kind === 'error' ? 'alert' : 'status'}
      data-testid="toast"
    >
      <p data-testid={toast.testId}>{toast.message}</p>
      <button
        type="button"
        className="icon-button"
        aria-label="Close this note"
        onClick={() => onDismiss(toast.id)}
      >
        &times;
      </button>
    </div>
  );
}
