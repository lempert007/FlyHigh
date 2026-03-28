import { useCallback, useState } from "react";
import { STEPS } from "../components/tutorial/tutorialSteps";

export interface TutorialAPI {
  active: boolean;
  stepIndex: number;
  total: number;
  start: () => void;
  next: () => void;
  back: () => void;
  stop: () => void;
}

export function useTutorial(): TutorialAPI {
  const [active, setActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);

  const start = useCallback(() => {
    setStepIndex(0);
    setActive(true);
  }, []);

  const next = useCallback(() => {
    setStepIndex((i) => {
      if (i >= STEPS.length - 1) { setActive(false); return 0; }
      return i + 1;
    });
  }, []);

  const back = useCallback(() => {
    setStepIndex((i) => Math.max(0, i - 1));
  }, []);

  const stop = useCallback(() => {
    setActive(false);
    setStepIndex(0);
  }, []);

  return { active, stepIndex, total: STEPS.length, start, next, back, stop };
}
