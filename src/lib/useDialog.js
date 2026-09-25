import { useEffect, useRef } from 'react';

/** Everything a person can tab to. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The parts of a dialog that are the same wherever it is used.
 *
 * Tab keeps you inside it, because a dialog you can tab out of leaves a
 * keyboard user typing into a page they cannot see. Escape closes it. Closing
 * it puts focus back where it was, so the next Tab carries on from where the
 * person left off rather than from the top of the page.
 *
 * @param {object} options
 * @param {() => void} options.onClose
 * @param {boolean} [options.active] - false while the dialog is not shown.
 * @returns {import('react').RefObject<HTMLElement>} put this on the dialog.
 */
export function useDialog({ onClose, active = true }) {
  const dialog = useRef(null);

  useEffect(() => {
    if (!active) return undefined;

    const cameFrom = document.activeElement;
    const element = dialog.current;

    // Focus the first thing worth focusing, or the dialog itself.
    const first = element?.querySelector(FOCUSABLE);
    (first ?? element)?.focus();

    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !element) return;

      const stops = [...element.querySelectorAll(FOCUSABLE)].filter(
        (stop) => stop.offsetParent !== null || stop === document.activeElement
      );
      if (stops.length === 0) return;

      const edge = event.shiftKey ? stops[0] : stops[stops.length - 1];
      if (document.activeElement !== edge) return;
      event.preventDefault();
      (event.shiftKey ? stops[stops.length - 1] : stops[0]).focus();
    };

    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      // Only take focus back if it is still inside the dialog that is closing.
      if (
        !element ||
        element.contains(document.activeElement) ||
        document.activeElement === document.body
      ) {
        cameFrom?.focus?.();
      }
    };
  }, [active, onClose]);

  return dialog;
}
