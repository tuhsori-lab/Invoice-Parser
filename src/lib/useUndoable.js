import { useCallback, useMemo, useState } from 'react';

/** How many steps back a person can go. Plenty for a session of fixing. */
const DEPTH = 100;

/**
 * A piece of state that remembers where it has been.
 *
 * Every fix made by hand goes through here, so Ctrl+Z always takes back the
 * last one - and Ctrl+Shift+Z puts it back. Detection settings are deliberately
 * not part of this: undo is for work you did, not for a checkbox you ticked.
 *
 * @param {*} initial
 */
export function useUndoable(initial) {
  const [timeline, setTimeline] = useState({ past: [], present: initial, future: [] });

  const set = useCallback((updater) => {
    setTimeline((current) => {
      const next = typeof updater === 'function' ? updater(current.present) : updater;
      if (Object.is(next, current.present)) return current;
      return {
        past: [...current.past, current.present].slice(-DEPTH),
        present: next,
        future: [],
      };
    });
  }, []);

  const undo = useCallback(() => {
    setTimeline((current) => {
      if (current.past.length === 0) return current;
      return {
        past: current.past.slice(0, -1),
        present: current.past[current.past.length - 1],
        future: [current.present, ...current.future],
      };
    });
  }, []);

  const redo = useCallback(() => {
    setTimeline((current) => {
      if (current.future.length === 0) return current;
      return {
        past: [...current.past, current.present],
        present: current.future[0],
        future: current.future.slice(1),
      };
    });
  }, []);

  const reset = useCallback((value) => {
    setTimeline({ past: [], present: value, future: [] });
  }, []);

  return useMemo(
    () => ({
      state: timeline.present,
      set,
      undo,
      redo,
      reset,
      canUndo: timeline.past.length > 0,
      canRedo: timeline.future.length > 0,
      steps: timeline.past.length,
    }),
    [timeline, set, undo, redo, reset]
  );
}
