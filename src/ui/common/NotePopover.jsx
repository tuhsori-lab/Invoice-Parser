import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/** How wide the note card is, in pixels. Kept in step with styles.css. */
const CARD_WIDTH = 320;

/**
 * A row's notes behind a small pill, in a card that opens on click, so a table
 * stays one tidy line per row. Drawn over the page rather than inside the
 * table, so a scrolling table never cuts it off. Closes on Escape, a click
 * elsewhere, or a scroll.
 *
 * @param {{ text: string }} props - the notes, separated by "; ".
 */
export default function NotePopover({ text }) {
  const notes = String(text ?? '')
    .split(/;\s+/)
    .map((note) => note.trim())
    .filter(Boolean);
  const button = useRef(null);
  const card = useRef(null);
  const [place, setPlace] = useState(null);

  useEffect(() => {
    if (!place) return undefined;
    const close = (event) => {
      if (event.type === 'keydown' && event.key !== 'Escape') return;
      if (
        event.type === 'pointerdown' &&
        (card.current?.contains(event.target) || button.current?.contains(event.target))
      ) {
        return;
      }
      setPlace(null);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [place]);

  if (notes.length === 0) return null;

  const toggle = (event) => {
    event.stopPropagation();
    if (place) {
      setPlace(null);
      return;
    }
    const box = button.current.getBoundingClientRect();
    const left = Math.max(
      12,
      Math.min(box.right - CARD_WIDTH, window.innerWidth - CARD_WIDTH - 12)
    );
    const below = box.bottom + 8;
    // Above the pill when there is no room for it below.
    const top = below + 160 > window.innerHeight ? null : below;
    setPlace({ left, top, bottom: top === null ? window.innerHeight - box.top + 8 : null });
  };

  return (
    <>
      <button
        type="button"
        ref={button}
        className="note-pill"
        aria-expanded={Boolean(place)}
        aria-haspopup="dialog"
        onClick={toggle}
        data-testid="note-pill"
      >
        <span className="note-pill-icon" aria-hidden="true">
          i
        </span>
        {notes.length === 1 ? '1 note' : `${notes.length} notes`}
      </button>
      {place &&
        createPortal(
          <div
            ref={card}
            className="note-card glass"
            role="dialog"
            aria-label="Notes"
            style={{
              left: place.left,
              top: place.top ?? undefined,
              bottom: place.bottom ?? undefined,
            }}
            onClick={(event) => event.stopPropagation()}
            data-testid="note-card"
          >
            <ul>
              {notes.map((note, at) => (
                <li key={at}>{note}</li>
              ))}
            </ul>
          </div>,
          document.body
        )}
    </>
  );
}
