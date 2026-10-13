import { THEME_CHOICES } from '../../lib/theme.js';

/**
 * Light, dark, or whatever this computer is set to.
 *
 * Invoice work happens at both ends of the day, and a screen that fights the
 * room is one more small irritation in a job that has enough of them.
 */
export default function ThemeChoice({ theme, onChange }) {
  return (
    <div className="segmented" role="group" aria-label="Colours" data-testid="theme-choice">
      {THEME_CHOICES.map((choice) => (
        <button
          key={choice.value}
          type="button"
          aria-pressed={theme === choice.value}
          onClick={() => onChange(choice.value)}
          data-testid={`theme-${choice.value}`}
        >
          {choice.label}
        </button>
      ))}
    </div>
  );
}
