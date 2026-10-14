import { useState } from 'react';

/**
 * Type in a value the PDF did not give - or change one - with a small "Add" or
 * "Edit" that opens into a field.
 * Enter saves, Escape lets it go. Clicks stay here rather than opening the row.
 */
export default function AddValue({ label, onSave, testId, initial = '' }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initial);
  const stop = (event) => event.stopPropagation();

  if (!editing) {
    return (
      <button
        type="button"
        className={initial ? 'edit-value' : 'add-value'}
        onClick={(event) => {
          stop(event);
          setValue(initial);
          setEditing(true);
        }}
        aria-label={initial ? `Change the ${label}` : undefined}
        title={initial ? `Change the ${label}` : undefined}
        data-testid={testId}
      >
        {initial ? 'Edit' : `Add ${label}`}
      </button>
    );
  }
  return (
    <form
      className="add-value-form"
      onClick={stop}
      onSubmit={(event) => {
        event.preventDefault();
        if (value.trim() && value.trim() !== initial) onSave(value.trim());
        setEditing(false);
      }}
    >
      <input
        type="text"
        // It opens because they asked to type, so the cursor goes straight there.
        autoFocus
        aria-label={`The ${label} on this invoice`}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setEditing(false);
        }}
        onBlur={() => !value.trim() && setEditing(false)}
        data-testid={testId ? `${testId}-input` : undefined}
      />
    </form>
  );
}
