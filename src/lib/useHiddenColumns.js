import { useCallback, useState } from 'react';

/**
 * The columns somebody has hidden in a table, remembered in this browser so a
 * table comes back the way they left it.
 *
 * @param {string} id - which table.
 * @returns {[string[], (keys: string[]) => void]} hidden column keys, and a setter.
 */
export function useHiddenColumns(id) {
  const key = `invoice-splitter.columns.${id}.v1`;
  const [hidden, setHidden] = useState(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(key) ?? '[]');
      return Array.isArray(saved) ? saved.filter((entry) => typeof entry === 'string') : [];
    } catch {
      return [];
    }
  });
  const save = useCallback(
    (keys) => {
      setHidden(keys);
      try {
        window.localStorage.setItem(key, JSON.stringify(keys));
      } catch {
        // Hidden for this visit only.
      }
    },
    [key]
  );
  return [hidden, save];
}
