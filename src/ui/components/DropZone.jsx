import { useRef, useState } from 'react';

/**
 * Where a batch comes in.
 *
 * Takes several PDFs at once and keeps the order they were chosen in, because
 * that order is the order of the pages. Once files are loaded it shrinks to a
 * single line, so the work takes the space rather than the upload box.
 */
export default function DropZone({ files, pageCount, onFiles, onClear, busy }) {
  const input = useRef(null);
  const [dragging, setDragging] = useState(false);

  const choose = (list) => {
    const pdfs = [...list].filter(
      (file) => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
    );
    if (pdfs.length > 0) onFiles(pdfs);
  };

  if (files.length > 0) {
    return (
      <div className="file-bar" data-testid="file-bar">
        <span className="file-bar-count">
          {files.length === 1 ? '1 file' : `${files.length} files`}, {pageCount}{' '}
          {pageCount === 1 ? 'page' : 'pages'}
        </span>
        <span className="file-bar-names" title={files.map((file) => file.name).join('\n')}>
          {files.map((file) => file.name).join(', ')}
        </span>
        <button type="button" className="link-button" onClick={onClear}>
          Start again
        </button>
      </div>
    );
  }

  return (
    <div
      className={`drop-zone${dragging ? ' is-dragging' : ''}`}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        choose(event.dataTransfer.files);
      }}
    >
      <p className="drop-zone-title">Drop your PDFs here</p>
      <p className="drop-zone-note">
        Several files at once is fine. They are read in the order you choose them.
      </p>
      <button
        type="button"
        className="button"
        disabled={busy}
        onClick={() => input.current?.click()}
      >
        Choose files
      </button>
      <input
        ref={input}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        className="visually-hidden"
        data-testid="file-input"
        onChange={(event) => {
          choose(event.target.files);
          event.target.value = '';
        }}
      />
      <p className="drop-zone-privacy">Your files stay on this computer. Nothing is uploaded.</p>
    </div>
  );
}
