import { useState, useCallback, useRef } from "react";
import type { LatLon, Waypoint, Poi, InteractionState, InteractionMode } from "../types/mission";
import { INTERACTION_RESET } from "../types/mission";
import { useUndoRedo } from "./useUndoRedo";

interface MissionSnapshot {
  start: LatLon | null;
  waypoints: Waypoint[];
  pois: Poi[];
}

const INITIAL_SNAPSHOT: MissionSnapshot = { start: null, waypoints: [], pois: [] };

const DEFAULT_POI = (): Poi => ({
  id: crypto.randomUUID(),
  name: "",
  point: { lat: 32.0, lon: 34.8 },
  maneuver: { type: "lawnmower", width_m: 100, height_m: 100, sweep_spacing_m: 30, poi_min_agl_m: null, poi_max_agl_m: null },
});

export interface MissionStateReturn {
  start: LatLon | null;
  waypoints: Waypoint[];
  pois: Poi[];
  missionName: string;
  missionNotes: string;
  interaction: InteractionState;
  canUndo: boolean;
  canRedo: boolean;
  setStart: (pt: LatLon | null) => void;
  setWaypoints: React.Dispatch<React.SetStateAction<Waypoint[]>>;
  setPois: React.Dispatch<React.SetStateAction<Poi[]>>;
  setMissionName: (v: string) => void;
  setMissionNotes: (v: string) => void;
  setInteraction: React.Dispatch<React.SetStateAction<InteractionState>>;
  undo: () => void;
  redo: () => void;
  resetHistory: (snap: MissionSnapshot) => void;
  handlePlacePoint: (pt: LatLon) => void;
  handleSetPlaceMode: (mode: InteractionMode) => void;
  handlePoiChange: (index: number, updated: Poi) => void;
  handlePoiDrag: (index: number, pt: LatLon) => void;
  handlePoiRemove: (index: number) => void;
  handlePoiActivatePlace: (index: number) => void;
  handlePoiDragStart: (index: number) => void;
  handlePoiDrop: (toIndex: number) => void;
  handleAddPoi: () => void;
  handleActivatePolygonDraw: (index: number) => void;
  handlePolygonVertex: (pt: LatLon) => void;
  handlePolygonVertexDragInProgress: (vi: number, pt: LatLon) => void;
  handlePolygonVertexDrag: (poiIdx: number, vi: number, pt: LatLon) => void;
  handlePolygonClose: () => void;
}

export function useMissionState(): MissionStateReturn {
  const { state: snap, set: setSnap, undo, redo, canUndo, canRedo, reset: resetHistory } = useUndoRedo<MissionSnapshot>(INITIAL_SNAPSHOT);

  // Keep a ref that always reflects the latest snapshot so handlers
  // can read current state without stale closure issues.
  const snapRef = useRef(snap);
  snapRef.current = snap;

  const { start, waypoints, pois } = snap;

  const [missionName, setMissionName] = useState("");
  const [missionNotes, setMissionNotes] = useState("");
  const [interaction, setInteraction] = useState<InteractionState>(INTERACTION_RESET);
  const dragFromIndex = useRef<number | null>(null);

  // ── Snapshot setters ──────────────────────────────────────────────────────

  const setStart = useCallback((pt: LatLon | null) => {
    const next = { ...snapRef.current, start: pt };
    snapRef.current = next;
    setSnap(next);
  }, [setSnap]);

  const setWaypoints = useCallback<React.Dispatch<React.SetStateAction<Waypoint[]>>>((updater) => {
    const cur = snapRef.current;
    const nextWaypoints = typeof updater === "function" ? updater(cur.waypoints) : updater;
    const next = { ...cur, waypoints: nextWaypoints };
    snapRef.current = next;
    setSnap(next);
  }, [setSnap]);

  const setPois = useCallback<React.Dispatch<React.SetStateAction<Poi[]>>>((updater) => {
    const cur = snapRef.current;
    const nextPois = typeof updater === "function" ? updater(cur.pois) : updater;
    const next = { ...cur, pois: nextPois };
    snapRef.current = next;
    setSnap(next);
  }, [setSnap]);

  // ── Mission handlers ──────────────────────────────────────────────────────

  const handlePlacePoint = useCallback(({ lat, lon }: LatLon) => {
    setInteraction((prev) => {
      if (prev.mode === "start") {
        setStart({ lat, lon });
        return INTERACTION_RESET;
      }
      if (prev.mode === "waypoint") {
        setWaypoints((wps) => [...wps, { lat, lon }]);
        return INTERACTION_RESET;
      }
      if (prev.mode === "poi") {
        if (prev.poiIndex !== null) {
          setPois((ps) => ps.map((p, i) => (i === prev.poiIndex ? { ...p, point: { lat, lon } } : p)));
        } else {
          setPois((ps) => [...ps, { ...DEFAULT_POI(), point: { lat, lon } }]);
        }
        return INTERACTION_RESET;
      }
      return prev;
    });
  }, [setStart, setWaypoints, setPois]);

  const handleSetPlaceMode = useCallback((mode: InteractionMode) => {
    setInteraction({ mode, poiIndex: null, polygonVertices: [] });
  }, []);

  const handlePoiChange = useCallback((index: number, updated: Poi) => {
    setPois((prev) => prev.map((p, i) => (i === index ? updated : p)));
  }, [setPois]);

  // Drag is continuous — use a local ref to avoid flooding history.
  // The snapshot is only committed on the next discrete action.
  const handlePoiDrag = useCallback((index: number, { lat, lon }: LatLon) => {
    const cur = snapRef.current;
    const nextPois = cur.pois.map((p, i) => (i === index ? { ...p, point: { lat, lon } } : p));
    // Update ref immediately so rendering uses latest pos, but don't push to history.
    snapRef.current = { ...cur, pois: nextPois };
    // Still call setSnap so React re-renders with the new position.
    setSnap({ ...cur, pois: nextPois });
  }, [setSnap]);

  const handlePoiRemove = useCallback((index: number) => {
    setPois((prev) => prev.filter((_, i) => i !== index));
  }, [setPois]);

  const handlePoiActivatePlace = useCallback((index: number) => {
    setInteraction({ mode: "poi", poiIndex: index, polygonVertices: [] });
  }, []);

  const handlePoiDragStart = useCallback((index: number) => {
    dragFromIndex.current = index;
  }, []);

  const handlePoiDrop = useCallback((toIndex: number) => {
    const from = dragFromIndex.current;
    if (from === null || from === toIndex) return;
    setPois((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
    dragFromIndex.current = null;
  }, [setPois]);

  const handleAddPoi = useCallback(() => {
    setInteraction({ mode: "poi", poiIndex: null, polygonVertices: [] });
  }, []);

  const handleActivatePolygonDraw = useCallback((index: number) => {
    setInteraction({ mode: "polygon", poiIndex: index, polygonVertices: [] });
  }, []);

  const handlePolygonVertex = useCallback(({ lat, lon }: LatLon) => {
    setInteraction((prev) => ({ ...prev, polygonVertices: [...prev.polygonVertices, { lat, lon }] }));
  }, []);

  const handlePolygonVertexDragInProgress = useCallback((vi: number, { lat, lon }: LatLon) => {
    setInteraction((prev) => ({
      ...prev,
      polygonVertices: prev.polygonVertices.map((v, i) => (i === vi ? { lat, lon } : v)),
    }));
  }, []);

  const handlePolygonVertexDrag = useCallback((poiIdx: number, vi: number, { lat, lon }: LatLon) => {
    setPois((prev) =>
      prev.map((p, i) =>
        i === poiIdx
          ? { ...p, maneuver: { ...p.maneuver, polygon: p.maneuver.polygon?.map((v, j) => (j === vi ? { lat, lon } : v)) } }
          : p
      )
    );
  }, [setPois]);

  const handlePolygonClose = useCallback(() => {
    setInteraction((prev) => {
      if (prev.mode === "polygon" && prev.poiIndex !== null && prev.polygonVertices.length >= 3) {
        const { poiIndex, polygonVertices: verts } = prev;
        setPois((ps) =>
          ps.map((p, i) => (i === poiIndex ? { ...p, maneuver: { ...p.maneuver, polygon: verts } } : p))
        );
      }
      return INTERACTION_RESET;
    });
  }, [setPois]);

  return {
    start, waypoints, pois, missionName, missionNotes, interaction,
    canUndo, canRedo,
    setStart, setWaypoints, setPois, setMissionName, setMissionNotes, setInteraction,
    undo, redo, resetHistory,
    handlePlacePoint, handleSetPlaceMode,
    handlePoiChange, handlePoiDrag, handlePoiRemove, handlePoiActivatePlace,
    handlePoiDragStart, handlePoiDrop, handleAddPoi,
    handleActivatePolygonDraw, handlePolygonVertex,
    handlePolygonVertexDragInProgress, handlePolygonVertexDrag, handlePolygonClose,
  };
}
