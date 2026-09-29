import { useRef } from 'react';
import { parseProfilesFile, serializeProfiles } from '../../core/profiles.js';
import { saveFile } from '../../lib/download.js';

/**
 * What this profile has been taught, in a line under its name.
 *
 * A saved spot is said first because it answers before any label does, so
 * somebody wondering why a client reads the way it does sees the reason first.
 *
 * @param {object} profile
 * @returns {string}
 */
function describeProfile(profile) {
  const parts = [];
  if (profile.zone) parts.push('a spot on the page');
  if (profile.labels.length > 0) parts.push(profile.labels.slice(0, 3).join(', '));
  return parts.length > 0 ? parts.join(' · ') : 'nothing taught yet';
}

/**
 * The client profiles this person has taught the app.
 *
 * A profile is one client's way of printing invoices. Switching several on at
 * once is the normal case: a bulk file usually holds invoices from more than one
 * client, and each page is matched to a profile on its own.
 */
export default function ProfilesPanel({
  profiles,
  active,
  onToggle,
  onEdit,
  onAdd,
  onImport,
  onProblem,
}) {
  const input = useRef(null);

  const importFile = async (file) => {
    const { profiles: imported, error } = parseProfilesFile(await file.text());
    if (error) onProblem(error);
    else onImport(imported);
  };

  return (
    <fieldset className="field-group" data-testid="profiles-panel">
      <legend>Client profiles</legend>

      {profiles.length === 0 ? (
        <p className="example">
          None yet. Add one when a client prints its invoice number after words nothing else
          recognises, or teach one from the page preview.
        </p>
      ) : (
        <ul className="profile-list">
          {profiles.map((profile) => (
            <li key={profile.id} className="profile-row">
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={active.includes(profile.id)}
                  onChange={() => onToggle(profile.id)}
                  data-testid={`profile-active-${profile.id}`}
                />
                <span className="profile-name">
                  {profile.name}
                  <small>{describeProfile(profile)}</small>
                </span>
              </label>
              <button
                type="button"
                className="link-button"
                onClick={() => onEdit(profile.id)}
                data-testid={`profile-edit-${profile.id}`}
              >
                Edit
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="profile-actions">
        <button type="button" className="link-button" onClick={onAdd} data-testid="profile-add">
          Add a profile
        </button>
        <button
          type="button"
          className="link-button"
          onClick={() => input.current?.click()}
          data-testid="profile-import"
        >
          Import
        </button>
        <button
          type="button"
          className="link-button"
          disabled={profiles.length === 0}
          data-testid="profile-export"
          onClick={() =>
            saveFile(
              serializeProfiles(profiles),
              'invoice-splitter-profiles.json',
              'application/json'
            )
          }
        >
          Export
        </button>
      </p>
      <small className="muted">
        Saved in this browser. Export them to move them to another computer.
      </small>

      <input
        ref={input}
        type="file"
        accept="application/json,.json"
        aria-label="Choose a profiles file to import"
        className="visually-hidden"
        data-testid="profile-import-input"
        onChange={(event) => {
          const [file] = event.target.files ?? [];
          if (file) importFile(file);
          event.target.value = '';
        }}
      />
    </fieldset>
  );
}
