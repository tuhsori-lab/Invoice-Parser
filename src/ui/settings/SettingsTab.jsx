import { useState } from 'react';
import ConfirmDialog from '../common/ConfirmDialog.jsx';
import ThemeChoice from './ThemeChoice.jsx';
import MatchingSettings from './MatchingSettings.jsx';

/**
 * Everything that is set once and kept: how invoices are split and named, how
 * the number is found, each client's box, light or dark, and starting afresh.
 *
 * The settings that belong to splitting are drawn by the Split tab itself into
 * `splitSlot`, so they work on the batch that is open without being copied.
 */
export default function SettingsTab({
  theme,
  onTheme,
  prefixes,
  onPrefixes,
  splitSlotRef,
  onForgetEverything,
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="settings-page">
      <div className="page-head">
        <h2>Settings</h2>
        <p>Kept in this browser only. Nothing here is sent anywhere.</p>
      </div>

      <div ref={splitSlotRef} className="settings-page" data-testid="split-settings" />

      <MatchingSettings prefixes={prefixes} onChange={onPrefixes} />

      <section className="settings-card" aria-labelledby="appearance-heading">
        <h3 id="appearance-heading">Appearance</h3>
        <p>System follows this computer&rsquo;s own light or dark setting.</p>
        <ThemeChoice theme={theme} onChange={onTheme} />
      </section>

      <section className="settings-card" aria-labelledby="data-heading">
        <h3 id="data-heading">Start afresh</h3>
        <p>
          Forget every saved box, learned number shape, column choice, count and setting in this
          browser. The batch you have open is closed too.
        </p>
        <button
          type="button"
          className="button quiet danger-button"
          onClick={() => setConfirming(true)}
          data-testid="reset-all"
        >
          Reset everything
        </button>
      </section>

      {confirming && (
        <ConfirmDialog
          question="Reset everything?"
          detail="Every client's box, learned shapes, column choices, counts and settings are forgotten. This cannot be undone."
          confirmLabel="Yes, reset"
          cancelLabel="Cancel"
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            onForgetEverything();
          }}
        />
      )}
    </div>
  );
}
