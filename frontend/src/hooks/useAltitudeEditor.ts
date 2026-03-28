/**
 * State management for the interactive altitude editor.
 *
 * Loads waypoints and AGL profile lazily from the ZIP blob when the editor
 * opens. Exposes a clean interface for dragging, inserting, removing nodes,
 * and resetting to the original algorithm output.
 */

import { useState, useCallback, useEffect } from "react";
import {
  AltNode,
  WpPoint,
  PoiBand,
  ValidationStatus,
  buildNodes,
  buildCumDists,
  buildAglBands,
  reconstructAltitudes,
  validateAltitudes,
  interpolateAltAtDist,
} from "../utils/altitudeEditorUtils";
import { fetchEditorData, fetchFolderEditorData } from "../api";

// ── Public interface ──────────────────────────────────────────────────────────

export interface AltEditorData {
  wps: WpPoint[];
  terrain: number[]; // terrain_elev[i] = wps[i].alt_m - aglProfile[i]
  cumDists: number[];
  poiBands: PoiBand[]; // per-POI AGL band overrides (may be empty)
  waypointIndices?: number[]; // dense-array indices for user-placed waypoints
}

export interface UseAltitudeEditorReturn {
  /** Loading state — true while reading the ZIP. */
  loading: boolean;
  loadError: string | null;
  /** The full dense dataset (immutable after load). */
  editorData: AltEditorData | null;
  /** Sparse control nodes (mutable). */
  nodes: AltNode[];
  /** Reconstructed full altitude array (derived from nodes). */
  reconAlt: number[];
  /** Per-waypoint AGL validation status (derived). */
  validation: ValidationStatus[];
  /** Per-waypoint min/max AGL bands (accounting for POI overrides). */
  minBand: number[];
  maxBand: number[];
  /** True if any node has been moved from its original altitude. */
  isDirty: boolean;
  dragNode: (id: string, newAlt: number) => void;
  dragTwoNodes: (idA: string, altA: number, idB: string, altB: number) => void;
  insertNode: (dist_m: number) => void;
  removeNode: (id: string) => void;
  reset: () => void;
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
  const [editorData, setEditorData] = useState<AltEditorData | null>(null);
  const [nodes, setNodes] = useState<AltNode[]>([]);
  const [insertCount, setInsertCount] = useState(0);

  // Load data from backend when modal opens
  useEffect(() => {
    if (!open || (!sessionId && !folder)) return;
    // Skip if already loaded
    if (editorData) return;

    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    (async () => {
      try {
        const data = sessionId
          ? await fetchEditorData(sessionId)
          : await fetchFolderEditorData(folder!);

        const wps: WpPoint[] = data.waypoints;
        const aglProfile: number[] = data.agl_profile;

        if (aglProfile.length !== wps.length) {
          throw new Error("Waypoint and AGL profile length mismatch");
        }

        const poiBands: PoiBand[] = data.poi_bands ?? [];
        const waypointIndices: number[] | undefined = data.waypoint_indices ?? undefined;
        const terrain = wps.map((w, i) => w.alt_m - aglProfile[i]);
        const cumDists = buildCumDists(wps);
        const initialNodes = buildNodes(wps, cumDists, waypointIndices);

        if (!cancelled) {
          setEditorData({ wps, terrain, cumDists, poiBands, waypointIndices });
          setNodes(initialNodes);
          setInsertCount(0);
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

  // Reset editorData when session or folder changes so next open re-loads fresh
  useEffect(() => {
    setEditorData(null);
    setNodes([]);
  }, [sessionId, folder]);

  // ── Derived state ──────────────────────────────────────────────────────────

  const reconAlt: number[] = editorData
    ? reconstructAltitudes(nodes, editorData.wps, editorData.cumDists)
    : [];

  const { minBand, maxBand } = editorData
    ? buildAglBands(editorData.cumDists, minAgl, maxAgl, editorData.poiBands)
    : { minBand: [] as number[], maxBand: [] as number[] };

  const validation: ValidationStatus[] = editorData
    ? validateAltitudes(reconAlt, editorData.terrain, minBand, maxBand)
    : [];

  const isDirty = nodes.some((n) => n.alt_m !== n.alt_m_original || n.type === "inserted");

  // ── Operations ─────────────────────────────────────────────────────────────

  const dragNode = useCallback((id: string, newAlt: number) => {
    setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, alt_m: newAlt } : n)));
  }, []);

  // Move two nodes in one setState call — avoids intermediate renders during segment drag
  const dragTwoNodes = useCallback((idA: string, altA: number, idB: string, altB: number) => {
    setNodes((prev) =>
      prev.map((n) =>
        n.id === idA ? { ...n, alt_m: altA } : n.id === idB ? { ...n, alt_m: altB } : n
      )
    );
  }, []);

  const insertNode = useCallback(
    (dist_m: number) => {
      if (!editorData) return;
      const alt = interpolateAltAtDist(nodes, editorData.wps, editorData.cumDists, dist_m);
      const id = `inserted_${insertCount}`;
      setInsertCount((c) => c + 1);
      setNodes((prev) => {
        const next: AltNode[] = [
          ...prev,
          { id, dist_m, alt_m: alt, alt_m_original: alt, type: "inserted" },
        ];
        return next.sort((a, b) => a.dist_m - b.dist_m);
      });
    },
    [editorData, nodes, insertCount]
  );

  const removeNode = useCallback((id: string) => {
    setNodes((prev) => prev.filter((n) => n.id !== id || n.type !== "inserted"));
  }, []);

  const reset = useCallback(() => {
    if (!editorData) return;
    const initialNodes = buildNodes(
      editorData.wps,
      editorData.cumDists,
      editorData.waypointIndices
    );
    setNodes(initialNodes);
    setInsertCount(0);
  }, [editorData]);

  return {
    loading,
    loadError,
    editorData,
    nodes,
    reconAlt,
    validation,
    minBand,
    maxBand,
    isDirty,
    dragNode,
    dragTwoNodes,
    insertNode,
    removeNode,
    reset,
  };
}
