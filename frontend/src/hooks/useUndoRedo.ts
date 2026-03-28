import { useState, useCallback } from "react";
import { MAX_UNDO_HISTORY } from "../constants";

export interface UndoRedoReturn<T> {
  state: T;
  /** Push a new state onto the history stack, discarding any redo future. */
  set: (next: T) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** Clear history and restart from a new initial state (e.g. after loading a route). */
  reset: (initial: T) => void;
}

interface HistoryState<T> {
  history: T[];
  cursor: number;
}

export function useUndoRedo<T>(initial: T): UndoRedoReturn<T> {
  const [{ history, cursor }, setState] = useState<HistoryState<T>>({
    history: [initial],
    cursor: 0,
  });

  const state = history[cursor];
  const canUndo = cursor > 0;
  const canRedo = cursor < history.length - 1;

  const set = useCallback((next: T) => {
    setState(({ history: h, cursor: c }) => {
      const trimmed = [...h.slice(0, c + 1), next];
      const capped = trimmed.length > MAX_UNDO_HISTORY ? trimmed.slice(-MAX_UNDO_HISTORY) : trimmed;
      return { history: capped, cursor: capped.length - 1 };
    });
  }, []);

  const undo = useCallback(() => {
    setState(({ history: h, cursor: c }) => ({ history: h, cursor: Math.max(0, c - 1) }));
  }, []);

  const redo = useCallback(() => {
    setState(({ history: h, cursor: c }) => ({ history: h, cursor: Math.min(h.length - 1, c + 1) }));
  }, []);

  const reset = useCallback((initial: T) => {
    setState({ history: [initial], cursor: 0 });
  }, []);

  return { state, set, undo, redo, canUndo, canRedo, reset };
}
