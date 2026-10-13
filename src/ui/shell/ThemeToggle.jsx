import Icon from '../common/Icon.jsx';

/**
 * Light or dark at a click. Until it is clicked the app follows this computer's
 * own setting; Settings also offers "System" to go back to following it.
 */
export default function ThemeToggle({ shown, onChange }) {
  const next = shown === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={() => onChange(next)}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
      data-testid="theme-toggle"
    >
      <Icon name={shown === 'dark' ? 'sun' : 'moon'} />
    </button>
  );
}
