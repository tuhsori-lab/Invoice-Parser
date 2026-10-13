/**
 * Light or dark, or whatever this computer is set to.
 *
 * The choice is written onto the root element as `data-theme`, always as a
 * definite light or dark - never as "system" - so the stylesheet needs one set
 * of dark values rather than two. index.html sets the same attribute before
 * anything is painted, so the page never flashes the wrong colours on the way
 * in.
 */

const KEY = 'invoice-splitter.theme.v1';

/** What a person can choose. */
export const THEME_CHOICES = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

/** What this computer is set to right now. */
function systemTheme() {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** The choice saved on this computer, or "system" if there is none. */
export function loadTheme() {
  try {
    const saved = window.localStorage.getItem(KEY);
    return THEME_CHOICES.some((choice) => choice.value === saved) ? saved : 'system';
  } catch {
    return 'system';
  }
}

/**
 * Put a choice into effect, and remember it.
 *
 * @param {'system'|'light'|'dark'} choice
 */
export function applyTheme(choice) {
  const root = document.documentElement;
  const next = choice === 'system' ? systemTheme() : choice;
  if (root.dataset.theme !== next) {
    // Every colour changes at once: nothing fades from light to dark half way.
    root.classList.add('theme-switching');
    root.dataset.theme = next;
    void root.offsetWidth;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => root.classList.remove('theme-switching'))
    );
  }
  try {
    if (choice === 'system') window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, choice);
  } catch {
    // A browser that will not remember it still shows it for this visit.
  }
}

/**
 * Follow the computer's own setting while "System" is chosen.
 *
 * @param {() => 'system'|'light'|'dark'} currentChoice
 * @param {() => void} [onApplied] - told once the page has switched.
 * @returns {() => void} stop following.
 */
export function watchSystemTheme(currentChoice, onApplied) {
  const media = window.matchMedia?.('(prefers-color-scheme: dark)');
  if (!media) return () => {};
  const update = () => {
    if (currentChoice() !== 'system') return;
    applyTheme('system');
    onApplied?.();
  };
  media.addEventListener('change', update);
  return () => media.removeEventListener('change', update);
}
