import { useEffect, useRef, useState } from 'react';
import { useDialog } from '../../lib/useDialog.js';
import { DEFAULT_TEMPLATE } from '../../core/naming.js';

/** One phrase per line, which is how people think about lists like this. */
const asLines = (list) => (list ?? []).join('\n');
const fromLines = (text) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

/**
 * Everything one client's profile holds.
 *
 * The important field is the identifying text: some words printed on that
 * client's invoices, usually their company name. That is what lets one bulk
 * file hold several clients and still get each one right.
 */
export default function ProfileEditor({ profile, canDelete, onSave, onDelete, onClose }) {
  const [draft, setDraft] = useState({
    name: profile.name === 'Untitled client' ? '' : profile.name,
    labels: asLines(profile.labels),
    extraLabel: profile.extraLabel ?? '',
    filenameTemplate: profile.filenameTemplate ?? '',
    identifyingText: asLines(profile.identifyingText),
  });
  const dialog = useDialog({ onClose });
  const nameField = useRef(null);

  useEffect(() => {
    nameField.current?.focus();
  }, []);

  const set = (key) => (event) =>
    setDraft((current) => ({ ...current, [key]: event.target.value }));

  const save = () => {
    onSave({
      ...profile,
      name: draft.name.trim() || 'Untitled client',
      labels: fromLines(draft.labels),
      extraLabel: draft.extraLabel.trim(),
      filenameTemplate: draft.filenameTemplate.trim(),
      identifyingText: fromLines(draft.identifyingText),
    });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal modal-narrow"
        role="dialog"
        aria-modal="true"
        aria-label="Client profile"
        tabIndex={-1}
        ref={dialog}
        data-testid="profile-editor"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="modal-head">
          <h2>Client profile</h2>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
            &times;
          </button>
        </header>

        <div className="editor-body">
          <label className="field">
            <span>Client name</span>
            <input
              ref={nameField}
              type="text"
              value={draft.name}
              onChange={set('name')}
              placeholder="Northwind Traders"
              data-testid="profile-name"
            />
            <small>Only used to label things in this app and in file names.</small>
          </label>

          <label className="field">
            <span>Recognise their pages by</span>
            <textarea
              rows={2}
              value={draft.identifyingText}
              onChange={set('identifyingText')}
              placeholder="Northwind Traders"
              data-testid="profile-identifying"
            />
            <small>
              Words printed on their invoices, usually the company name. One per line. A page with
              any of these on it has this profile&rsquo;s labels tried first.
            </small>
          </label>

          <label className="field">
            <span>Their invoice number comes after</span>
            <textarea
              rows={3}
              value={draft.labels}
              onChange={set('labels')}
              placeholder={'Our Ref\nOrder No'}
              data-testid="profile-labels"
            />
            <small>One label per line, best first.</small>
          </label>

          <label className="field">
            <span>Extra field for the file name</span>
            <input
              type="text"
              value={draft.extraLabel}
              onChange={set('extraLabel')}
              placeholder="Store #"
              data-testid="profile-extra"
            />
          </label>

          <label className="field">
            <span>Name their files differently (optional)</span>
            <input
              type="text"
              value={draft.filenameTemplate}
              onChange={set('filenameTemplate')}
              placeholder={DEFAULT_TEMPLATE}
              spellCheck="false"
              data-testid="profile-template"
            />
            <small>Leave empty to use the batch-wide pattern.</small>
          </label>
        </div>

        <footer className="editor-foot">
          {/* A profile that has not been saved yet has nothing to delete. */}
          {canDelete ? (
            <button
              type="button"
              className="link-button danger"
              onClick={() => onDelete(profile.id)}
              data-testid="profile-delete"
            >
              Delete this profile
            </button>
          ) : (
            <span />
          )}
          <span className="editor-foot-buttons">
            <button type="button" className="button quiet" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="button" onClick={save} data-testid="profile-save">
              Save profile
            </button>
          </span>
        </footer>
      </div>
    </div>
  );
}
