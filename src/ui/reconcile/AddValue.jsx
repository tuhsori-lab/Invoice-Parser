import { useState } from 'react';

/**
 * Type in a value the PDF did not give: a small "Add" that opens into a field.
 * Enter saves, Escape lets it go. Clicks stay here rather than opening the row.
 */
export default function AddValue({ label, onSave, testId }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const stop = (event) => event.stopPropagation();

  if (!editing) {
    return (
      <button
        type="button"
        className="add-value"
        onClick={(event) => {
          stop(event);
          setEditing(true);
        }}
        data-testid={testId}
      >
        Add {label}
      </button>
    );
  }
  return (
    <form
      className="add-value-form"
      onClick={stop}
      onSubmit={(event) => {
        event.preventDefault();
        if (value.trim()) onSave(value.trim());
        setEditing(false);
        setValue('');
      }}
    >
      <input
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
