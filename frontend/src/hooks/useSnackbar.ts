import { useState, useCallback } from "react";

export type SnackSeverity = "success" | "info" | "warning" | "error";

export interface Snack {
  message: string;
  severity: SnackSeverity;
  key: number;
}

export interface UseSnackbarReturn {
  snack: Snack | null;
  showSnack: (message: string, severity?: SnackSeverity) => void;
  clearSnack: () => void;
}

export function useSnackbar(): UseSnackbarReturn {
  const [snack, setSnack] = useState<Snack | null>(null);

  const showSnack = useCallback((message: string, severity: SnackSeverity = "info") => {
    setSnack({ message, severity, key: Date.now() });
  }, []);

  const clearSnack = useCallback(() => setSnack(null), []);

  return { snack, showSnack, clearSnack };
}
