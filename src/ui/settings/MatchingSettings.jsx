import { useEffect, useState } from 'react';
import { DEFAULT_PREFIXES, cleanPrefixes, matchKey } from '../../core/reconcile/normalize.js';

/**
 * How Reconcile cleans numbers up before comparing them, and the prefixes it
 * takes off the front. Shown with a worked example, so the effect is plain.
 */
export default function MatchingSettings({ prefixes, onChange }) {
  const [draft, setDraft] = useState(prefixes);
  useEffect(() => setDraft(prefixes), [prefixes]);
  const example = 'INV-00123';
  const cleaned = matchKey(example, { prefixes: cleanPrefixes(draft) });

  return (
    <section className="settings-card" aria-labelledby="matching-heading">
      <h3 id="matching-heading">Matching (Reconcile)</h3>
      <p>
        Before a PDF&rsquo;s number and a sheet&rsquo;s number are compared, both are cleaned up:
        spaces, capitals, separators (- _ / . #) and leading zeros are ignored, and these prefixes
        are taken off the front. Numbers are always shown as they were written.
      </p>
      <label className="field">
        <span>Prefixes to take off, separated by commas</span>
        <input
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => onChange(draft)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onChange(draft);
          }}
          spellCheck="false"
          data-testid="match-prefixes"
        />
        <small>
          With these, <code>{example}</code> is compared as <code>{cleaned || '(nothing)'}</code>.{' '}
          <button
            type="button"
            className="link-button"
            onClick={() => onChange(DEFAULT_PREFIXES.join(', '))}
            data-testid="match-prefixes-reset"
          >
            Back to the usual ones
          </button>
        </small>
      </label>
    </section>
  );
}
