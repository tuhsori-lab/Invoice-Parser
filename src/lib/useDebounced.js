import { useEffect, useState } from 'react';

/**
 * A value that settles down before anything reacts to it.
 *
 * Typing in the file name template re-runs detection on every keystroke
 * otherwise, which on a large batch makes the whole app stutter.
 *
 * @param {*} value
 * @param {number} [delay] - milliseconds of quiet before the value updates.
 */
export function useDebounced(value, delay = 200) {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return settled;
}
