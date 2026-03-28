import { useState, useEffect, useRef, useCallback } from "react";
import type { LatLon, Waypoint, Poi, FlightConfig } from "../types/mission";
import { DRAFT_STORAGE_KEY, DRAFT_SAVE_DEBOUNCE_MS } from "../constants";

export interface DraftState {
  start: LatLon | null;
  waypoints: Waypoint[];
  pois: Poi[];
  missionName: string;
  missionNotes: string;
  flightConfig: FlightConfig;
  takeoffMode: "auto" | "fixed";
  takeoffAltM: number;
}

interface SavedDraft extends DraftState {
  savedAt: string; // ISO timestamp
}

export interface UseDraftPersistenceReturn {
  hasDraft: boolean;
  draftAge: string;
  restoreDraft: () => void;
  clearDraft: () => void;
}

function formatAge(savedAt: string): string {
  const ageMs = Date.now() - new Date(savedAt).getTime();
  const ageMin = Math.floor(ageMs / 60000);
  if (ageMin < 1) return "just now";
  if (ageMin < 60) return `${ageMin}m ago`;
  const ageH = Math.floor(ageMin / 60);
  if (ageH < 24) return `${ageH}h ago`;
  return `${Math.floor(ageH / 24)}d ago`;
}

export function useDraftPersistence(
  state: DraftState,
  onRestore: (draft: DraftState) => void,
  { enabled = true }: { enabled?: boolean } = {}
): UseDraftPersistenceReturn {
  const [draftInfo, setDraftInfo] = useState<{ age: string; raw: SavedDraft } | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onRestoreRef = useRef(onRestore);
  onRestoreRef.current = onRestore;

  // On mount: check for existing draft and offer restoration
  useEffect(() => {
    if (!enabled) return;
    let mounted = true;
    try {
      const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
      if (!raw) return;
      const draft = JSON.parse(raw) as SavedDraft;
      // Assign IDs to pois that predate the id field
      const poisWithIds = draft.pois.map((p) => ({
        ...p,
        id: (p as { id?: string }).id ?? crypto.randomUUID(),
      }));
      if (mounted)
        setDraftInfo({ age: formatAge(draft.savedAt), raw: { ...draft, pois: poisWithIds } });
    } catch {
      /* corrupt data — ignore */
    }
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally runs once on mount — re-checking on enabled change is not desired

  // Auto-save on debounce whenever meaningful state changes
  const hasContent = !!(state.start || state.waypoints.length || state.pois.length);
  useEffect(() => {
    if (!enabled || !hasContent) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const toSave: SavedDraft = { ...state, savedAt: new Date().toISOString() };
      try {
        localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(toSave));
      } catch {
        /* storage full — ignore */
      }
    }, DRAFT_SAVE_DEBOUNCE_MS);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [state, hasContent, enabled]);

  const restoreDraft = useCallback(() => {
    if (!draftInfo) return;
    onRestoreRef.current(draftInfo.raw);
    setDraftInfo(null);
  }, [draftInfo]);

  const clearDraft = useCallback(() => {
    localStorage.removeItem(DRAFT_STORAGE_KEY);
    setDraftInfo(null);
  }, []);

  return {
    hasDraft: draftInfo !== null,
    draftAge: draftInfo?.age ?? "",
    restoreDraft,
    clearDraft,
  };
}
