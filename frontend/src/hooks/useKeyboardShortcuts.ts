import { useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { InteractionState, Waypoint } from "../types/mission";
import { INTERACTION_RESET } from "../types/mission";

interface Options {
  interaction: InteractionState;
  setInteraction: Dispatch<SetStateAction<InteractionState>>;
  setWaypoints: Dispatch<SetStateAction<Waypoint[]>>;
}

/** Attaches global Esc / Backspace keyboard shortcuts for mission placement state. */
export function useKeyboardShortcuts({ interaction, setInteraction, setWaypoints }: Options): void {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "INPUT" ||
          (e.target as HTMLElement).tagName === "TEXTAREA") return;

      if (e.key === "Escape") {
        setInteraction(INTERACTION_RESET);
      } else if (e.key === "Backspace" || e.key === "Delete") {
        setInteraction((prev) => {
          if (prev.mode === "polygon" && prev.polygonVertices.length > 0) {
            e.preventDefault();
            return { ...prev, polygonVertices: prev.polygonVertices.slice(0, -1) };
          }
          if (prev.mode === "waypoint") {
            setWaypoints((wps) => wps.slice(0, -1));
          }
          return prev;
        });
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  // interaction is only needed to keep the closure up-to-date for the polygon branch
  }, [interaction, setInteraction, setWaypoints]);
}
