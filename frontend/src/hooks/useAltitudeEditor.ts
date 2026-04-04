/**
 * State management for the Plotly-based altitude editor.
 *
 * Manages the full dense altitude array, undo/redo history, drag state, and apply/save.
 */

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import type { ProfilePoint, PlanMeta, Violation } from "../types/mission";
import {
  WpPoint,
  PoiBand,
  ValidationStatus,
  buildCumDists,
  buildAglBands,
  validateAltitudes,
} from "../utils/altitudeEditorUtils";
import {
  fetchEditorData,
  fetchFolderEditorData,
  applyAltitudeEdit,
  applyFolderAltitudeEdit,
} from "../api";

const MAX_HISTORY = 50;

// ── Public interface ──────────────────────────────────────────────────────────

export interface EditorData {
  wps: WpPoint[];
  terrain: number[];
  cumDists: number[];
  poiBands: PoiBand[];
  waypointIndices: number[];
  bubblePeakTerrain: number[] | null;
  cameraMinTerrain: number[] | null;
  profilePoints: ProfilePoint[];
}

export interface UseAltitudeEditorReturn {
  loading: boolean;
  loadError: string | null;
  saving: boolean;
  saveError: string | null;
  editorData: EditorData | null;
  /** Displayed altitude array (splices in live drag value). */
  alts: number[];
  aglProfile: number[];
  validation: ValidationStatus[];
  minBand: number[];
  maxBand: number[];
  selectedIdx: number | null;
  /** End of a manually chosen range (shift-click). null = no range active. */
  selectedRangeEnd: number | null;
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /** Set the altitude of a single waypoint and push to history. */
  setAlt: (idx: number, alt_m: number) => void;
  /** Shift all waypoints in a POI zone by `delta` metres and push to history. */
  adjustZone: (poiId: number, delta: number) => void;
  /** Shift a single waypoint by `delta` metres (convenience over setAlt). */
  nudge: (idx: number, delta: number) => void;
  /** Shift all waypoints in [min(a,b), max(a,b)] by `delta` metres. */
  adjustRange: (fromIdx: number, toIdx: number, delta: number) => void;
  /** Set all waypoints in [min(a,b), max(a,b)] to the same absolute MSL altitude. */
  setRangeAlt: (fromIdx: number, toIdx: number, alt_m: number) => void;
  selectIdx: (idx: number | null) => void;
  /** Violations produced by the most recent save. Empty until the first save. */
  lastSaveViolations: Violation[];
  /** Extend or clear the range end (shift-click). Setting to null also clears it. */
  selectRangeEnd: (idx: number | null) => void;
  undo: () => void;
  redo: () => void;
  reset: () => void;
  save: () => Promise<{ blob: Blob; meta: PlanMeta | null } | null>;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useAltitudeEditor(
  sessionId: string | null,
  folder: string | null,
  open: boolean,
  minAgl: number,
  maxAgl: number
): UseAltitudeEditorReturn {
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [editorData, setEditorData] = useState<EditorData | null>(null);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [lastSaveViolations, setLastSaveViolations] = useState<Violation[]>([]);

  // History stack; historyIdx points to the current committed state
  const history = useRef<number[][]>([]);
  const historyIdx = useRef<number>(-1);
  const [historyVersion, setHistoryVersion] = useState(0);

  const currentAlts = (): number[] => {
    if (historyIdx.current < 0 || history.current.length === 0) return [];
    return history.current[historyIdx.current];
  };

  const pushHistory = useCallback((alts: number[]) => {
    history.current = history.current.slice(0, historyIdx.current + 1);
    history.current.push(alts);
    if (history.current.length > MAX_HISTORY) history.current.shift();
    historyIdx.current = history.current.length - 1;
    setHistoryVersion((v) => v + 1);
  }, []);

  // ── Load ────────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!open || (!sessionId && !folder)) return;
    if (editorData) return;

    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    (async () => {
      try {
        const data = folder
          ? await fetchFolderEditorData(folder)
          : await fetchEditorData(sessionId!);

        const wps: WpPoint[] = data.waypoints;
        const aglProfile: number[] = data.agl_profile;
        if (aglProfile.length !== wps.length) throw new Error("Waypoint/AGL length mismatch");

        const terrain = wps.map((w, i) => w.alt_m - aglProfile[i]);
        const cumDists = buildCumDists(wps);
        const initialAlts = wps.map((w) => w.alt_m);

        if (!cancelled) {
          setEditorData({
            wps,
            terrain,
            cumDists,
            poiBands: data.poi_bands ?? [],
            waypointIndices: data.waypoint_indices ?? [],
            bubblePeakTerrain: data.bubble_peak_terrain ?? null,
            cameraMinTerrain: data.camera_min_terrain ?? null,
            profilePoints: (data.profile_points ?? []) as ProfilePoint[],
          });
          history.current = [initialAlts];
          historyIdx.current = 0;
          setHistoryVersion(1);
          setSelectedIdx(null);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, sessionId, folder]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset when session/folder changes
  useEffect(() => {
    setEditorData(null);
    history.current = [];
    historyIdx.current = -1;
    setHistoryVersion(0);
    setSelectedIdx(null);
    setSaveError(null);
  }, [sessionId, folder]);

  // ── Derived state ───────────────────────────────────────────────────────────

  const committedAlts = currentAlts();

  const { minBand, maxBand } = useMemo(
    () =>
      editorData
        ? buildAglBands(
            editorData.cumDists,
            editorData.terrain,
            minAgl,
            maxAgl,
            editorData.poiBands,
            editorData.bubblePeakTerrain,
            editorData.cameraMinTerrain
          )
        : { minBand: [] as number[], maxBand: [] as number[] },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editorData, minAgl, maxAgl, historyVersion]
  );

  const aglProfile = useMemo(
    () => (editorData ? committedAlts.map((a, i) => a - editorData.terrain[i]) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editorData, historyVersion]
  );

  const validation: ValidationStatus[] = useMemo(
    () =>
      editorData ? validateAltitudes(committedAlts, editorData.terrain, minBand, maxBand) : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editorData, historyVersion, minBand, maxBand]
  );

  const originalAlts = history.current[0] ?? [];
  const dirty =
    historyIdx.current > 0 || committedAlts.some((a, i) => a !== (originalAlts[i] ?? a));

  const canUndo = historyIdx.current > 0;
  const canRedo = historyIdx.current < history.current.length - 1;

  // ── Operations ──────────────────────────────────────────────────────────────

  const setAlt = useCallback(
    (idx: number, alt_m: number) => {
      const prev = currentAlts();
      if (prev.length === 0) return;
      const next = [...prev];
      next[idx] = alt_m;
      pushHistory(next);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pushHistory, historyVersion]
  );

  const nudge = useCallback(
    (idx: number, delta: number) => {
      const prev = currentAlts();
      if (prev.length === 0) return;
      const next = [...prev];
      next[idx] = prev[idx] + delta;
      pushHistory(next);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pushHistory, historyVersion]
  );

  const adjustZone = useCallback(
    (poiId: number, delta: number) => {
      if (!editorData) return;
      const prev = currentAlts();
      if (prev.length === 0) return;
      const next = [...prev];
      for (let i = 0; i < editorData.profilePoints.length; i++) {
        if (editorData.profilePoints[i].poi_id === poiId) {
          next[i] = prev[i] + delta;
        }
      }
      pushHistory(next);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editorData, pushHistory, historyVersion]
  );

  const [selectedRangeEnd, setSelectedRangeEnd] = useState<number | null>(null);

  const adjustRange = useCallback(
    (fromIdx: number, toIdx: number, delta: number) => {
      const prev = currentAlts();
      if (prev.length === 0) return;
      const lo = Math.min(fromIdx, toIdx);
      const hi = Math.max(fromIdx, toIdx);
      const next = [...prev];
      for (let i = lo; i <= hi; i++) next[i] = prev[i] + delta;
      pushHistory(next);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pushHistory, historyVersion]
  );

  const setRangeAlt = useCallback(
    (fromIdx: number, toIdx: number, alt_m: number) => {
      const prev = currentAlts();
      if (prev.length === 0) return;
      const lo = Math.min(fromIdx, toIdx);
      const hi = Math.max(fromIdx, toIdx);
      const next = [...prev];
      for (let i = lo; i <= hi; i++) next[i] = alt_m;
      pushHistory(next);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pushHistory, historyVersion]
  );

  const selectIdx = useCallback((idx: number | null) => {
    setSelectedIdx(idx);
    if (idx === null) setSelectedRangeEnd(null);
  }, []);

  const selectRangeEnd = useCallback((idx: number | null) => setSelectedRangeEnd(idx), []);

  const undo = useCallback(() => {
    if (historyIdx.current <= 0) return;
    historyIdx.current -= 1;
    setHistoryVersion((v) => v + 1);
  }, []);

  const redo = useCallback(() => {
    if (historyIdx.current >= history.current.length - 1) return;
    historyIdx.current += 1;
    setHistoryVersion((v) => v + 1);
  }, []);

  const reset = useCallback(() => {
    if (history.current.length === 0) return;
    history.current = [history.current[0]];
    historyIdx.current = 0;
    setHistoryVersion((v) => v + 1);
    setSelectedIdx(null);
  }, []);

  const save = useCallback(async (): Promise<{ blob: Blob; meta: PlanMeta | null } | null> => {
    const curAlts = currentAlts();
    if (curAlts.length === 0) return null;
    setSaving(true);
    setSaveError(null);
    try {
      const result = folder
        ? await applyFolderAltitudeEdit(folder, curAlts)
        : await applyAltitudeEdit(sessionId!, curAlts);
      setLastSaveViolations(result?.meta?.violations ?? []);
      return result;
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setSaving(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, folder, historyVersion]);

  return {
    loading,
    loadError,
    saving,
    saveError,
    editorData,
    alts: committedAlts,
    aglProfile,
    validation,
    minBand,
    maxBand,
    selectedIdx,
    selectedRangeEnd,
    lastSaveViolations,
    dirty,
    canUndo,
    canRedo,
    setAlt,
    nudge,
    adjustZone,
    adjustRange,
    setRangeAlt,
    selectIdx,
    selectRangeEnd,
    undo,
    redo,
    reset,
    save,
  };
}
