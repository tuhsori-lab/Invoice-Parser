import { useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { filesFromDrop, filesFromInput } from '../../lib/droppedFiles.js';

/**
 * A place to drop files - or whole folders - with a clear empty state, and
 * buttons for people who would rather choose them.
 *
 * Hands over `{ file, path }` for every file, folders walked through; which of
 * them are wanted is up to whoever receives them.
 */
export default function DropArea({
  title,
  note,
  accept,
  multiple = true,
  folders = false,
  onFiles,
  busy = false,
  compact = false,
  inputLabel,
  testId,
  children,
}) {
  const files = useRef(null);
  const folder = useRef(null);
  const [dragging, setDragging] = useState(false);

  const hand = (found) => {
    if (found.length > 0) onFiles(found);
  };

  return (
    <div
      className={`drop-zone${dragging ? ' is-dragging' : ''}${compact ? ' is-compact' : ''}`}
      data-testid={testId}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={async (event) => {
        event.preventDefault();
        setDragging(false);
        if (busy) return;
        hand(await filesFromDrop(event.dataTransfer));
      }}
    >
      {!compact && (
        <span className="drop-zone-icon">
          <Icon name="upload" size={20} />
        </span>
      )}
      <p className="drop-zone-title">{title}</p>
      {note && <p className="drop-zone-note">{note}</p>}
      <div className="drop-zone-buttons">
        <button
          type="button"
          className="button"
          disabled={busy}
          onClick={() => files.current?.click()}
        >
          {multiple ? 'Choose files' : 'Choose a file'}
        </button>
        {folders && (
          <button
            type="button"
            className="button quiet"
            disabled={busy}
            onClick={() => folder.current?.click()}
          >
            Choose a folder
          </button>
        )}
      </div>
      <input
        ref={files}
        type="file"
        accept={accept}
        multiple={multiple}
        aria-label={inputLabel ?? title}
        className="visually-hidden"
        data-testid={testId ? `${testId}-input` : undefined}
        onChange={(event) => {
          hand(filesFromInput(event.target.files));
          event.target.value = '';
        }}
      />
      {folders && (
        <input
          ref={folder}
          type="file"
          webkitdirectory=""
          multiple
          aria-label={`${inputLabel ?? title}: a whole folder`}
          className="visually-hidden"
          onChange={(event) => {
            hand(filesFromInput(event.target.files));
            event.target.value = '';
          }}
        />
      )}
      {children}
    </div>
  );
}
