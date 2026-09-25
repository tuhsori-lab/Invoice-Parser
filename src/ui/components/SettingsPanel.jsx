import { useState } from 'react';
import { DEFAULT_TEMPLATE } from '../../core/naming.js';
import { compileCustomPattern } from '../../core/detect.js';

/**
 * How the batch should be split, and what the files should be called.
 *
 * Everything here re-runs detection over text that is already in memory, so
 * changing a setting is instant and never re-reads a PDF.
 */
export default function SettingsPanel({ settings, onChange, nameExample }) {
  const [advancedOpen, setAdvancedOpen] = useState(Boolean(settings.customPattern));
  const set = (key) => (event) => {
    const target = event.target;
    onChange(key, target.type === 'checkbox' ? target.checked : target.value);
  };
  const patternProblem = compileCustomPattern(settings.customPattern).error;

  return (
    <aside className="settings" aria-label="Split settings">
      <fieldset className="field-group">
        <legend>Split into invoices</legend>

        <label className="choice">
          <input
            type="radio"
            name="mode"
            value="by-number"
            checked={settings.mode === 'by-number'}
            onChange={set('mode')}
          />
          <span>
            By invoice number
            <small>Pages carrying the same number belong together.</small>
          </span>
        </label>

        <label className="choice">
          <input
            type="radio"
            name="mode"
            value="by-marker"
            checked={settings.mode === 'by-marker'}
            onChange={set('mode')}
          />
          <span>
            When a phrase appears
            <small>A new invoice starts on any page with this on it.</small>
          </span>
        </label>
        {settings.mode === 'by-marker' && (
          <label className="field indented">
            <span>Phrase</span>
            <input type="text" value={settings.markerText} onChange={set('markerText')} />
          </label>
        )}

        <label className="choice">
          <input
            type="radio"
            name="mode"
            value="every-n"
            checked={settings.mode === 'every-n'}
            onChange={set('mode')}
          />
          <span>
            Every few pages
            <small>For batches where every invoice is the same length.</small>
          </span>
        </label>
        {settings.mode === 'every-n' && (
          <label className="field indented">
            <span>Pages per invoice</span>
            <input
              type="number"
              min="1"
              value={settings.pagesPerInvoice}
              onChange={set('pagesPerInvoice')}
            />
          </label>
        )}
      </fieldset>

      {settings.mode === 'by-number' && (
        <fieldset className="field-group">
          <legend>Pages with no number on them</legend>
          <label className="choice">
            <input
              type="radio"
              name="unnumbered"
              value="attach"
              checked={settings.unnumbered === 'attach'}
              onChange={set('unnumbered')}
            />
            <span>
              Keep with the invoice before
              <small>Second pages and remittance slips usually belong there.</small>
            </span>
          </label>
          <label className="choice">
            <input
              type="radio"
              name="unnumbered"
              value="review"
              checked={settings.unnumbered === 'review'}
              onChange={set('unnumbered')}
            />
            <span>
              Set aside for me to look at
              <small>Nothing is guessed; you decide where they go.</small>
            </span>
          </label>
          <label className="toggle">
            <input type="checkbox" checked={settings.combinePages} onChange={set('combinePages')} />
            <span>Combine pages sharing a number, even when they are apart</span>
          </label>
        </fieldset>
      )}

      <fieldset className="field-group">
        <legend>Finding the number</legend>
        <label className="toggle">
          <input
            type="checkbox"
            checked={settings.useCommonLabels}
            onChange={set('useCommonLabels')}
          />
          <span>
            Try everyday labels, such as &ldquo;Invoice No.&rdquo; and &ldquo;Bill #&rdquo;
          </span>
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={settings.useBareInvoice}
            onChange={set('useBareInvoice')}
          />
          <span>Also accept &ldquo;Invoice 445566&rdquo; with no label at all</span>
        </label>
        <label className="field">
          <span>Extra field for the file name</span>
          <input
            type="text"
            placeholder="PO #"
            value={settings.extraLabel}
            onChange={set('extraLabel')}
          />
          <small>The words this is printed after, for example PO # or Store #.</small>
        </label>
      </fieldset>

      <fieldset className="field-group">
        <legend>File names</legend>
        <label className="field">
          <span>Start every name with</span>
          <input
            type="text"
            placeholder="Nothing"
            value={settings.prefix}
            onChange={set('prefix')}
          />
        </label>
        <label className="field">
          <span>Name pattern</span>
          <input
            type="text"
            value={settings.template}
            onChange={set('template')}
            spellCheck="false"
          />
          <small>
            {'{invoice} {extra} {client} {pages} {index} {prefix}'}
            {settings.template !== DEFAULT_TEMPLATE && (
              <>
                {' '}
                <button
                  type="button"
                  className="link-button"
                  onClick={() => onChange('template', DEFAULT_TEMPLATE)}
                >
                  Reset
                </button>
              </>
            )}
          </small>
        </label>
        <p className="example" data-testid="name-example">
          Example: <code>{nameExample}</code>
        </p>
      </fieldset>

      <section className="field-group">
        <button
          type="button"
          className="disclosure"
          aria-expanded={advancedOpen}
          onClick={() => setAdvancedOpen((open) => !open)}
        >
          Advanced
        </button>
        {advancedOpen && (
          <label className="field">
            <span>Find the number with my own pattern</span>
            <input
              type="text"
              placeholder="Ref\s*([0-9]+)"
              value={settings.customPattern}
              onChange={set('customPattern')}
              spellCheck="false"
              aria-invalid={Boolean(patternProblem)}
            />
            <small>
              {patternProblem ? (
                <span className="problem">{patternProblem}</span>
              ) : (
                'Used instead of everything above. Put brackets around the part that is the number.'
              )}
            </small>
          </label>
        )}
      </section>
    </aside>
  );
}
