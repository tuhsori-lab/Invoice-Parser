import { THEME_CHOICES } from '../../lib/theme.js';

/**
 * Light, dark, or whatever this computer is set to.
 *
 * Invoice work happens at both ends of the day, and a screen that fights the
 * room is one more small irritation in a job that has enough of them.
 */
export default function ThemeChoice({ theme, onChange }) {
  return (
    <label className="theme-choice">
      <span className="visually-hidden">Colours</span>
      <select
        value={theme}
        onChange={(event) => onChange(event.target.value)}
        data-testid="theme-choice"
        title="Light or dark"
      >
        {THEME_CHOICES.map((choice) => (
          <option key={choice.value} value={choice.value}>
            {choice.label}
          </option>
        ))}
      </select>
    </label>
  );
}
