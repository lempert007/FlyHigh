/**
 * Manages all terrain/session state: TIFF uploads, elevation overlays,
 * session ID, and blob URL lifecycle.
 *
 * Extracted from App.tsx to keep terrain concerns isolated.
 */

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import type { ElevationOverlay, TiffSelection, UploadResult } from "../types/mission";
import { fetchElevationImage } from "../api";

export interface TerrainState {
  sessionId: string | null;
  uploadResult: UploadResult | null;
  tiffSelections: TiffSelection[];
  elevationOverlays: ElevationOverlay[];
  elevationErrors: Record<string, string>;
  /** DSM/DTM types present in the current tiff selection. */
  availableTerrainTypes: ("DSM" | "DTM")[];
  /** Apply a new upload result: sets session, tiff selections, fetches overlays. */
  applyUploadResult: (result: UploadResult) => Promise<void>;
  /** Clear all terrain state (e.g. when user removes files). */
  clearTerrain: () => void;
}

export function useTerrainState(): TerrainState {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [tiffSelections, setTiffSelections] = useState<TiffSelection[]>([]);
  const [elevationOverlays, setElevationOverlays] = useState<ElevationOverlay[]>([]);
  const [elevationErrors, setElevationErrors] = useState<Record<string, string>>({});

  const blobUrlsRef = useRef<string[]>([]);

  const revokeBlobUrls = useCallback(() => {
    blobUrlsRef.current.forEach((u) => URL.revokeObjectURL(u));
    blobUrlsRef.current = [];
  }, []);

  // Clean up object URLs on unmount
  useEffect(() => () => revokeBlobUrls(), [revokeBlobUrls]);

  const availableTerrainTypes = useMemo(
    () => [...new Set(tiffSelections.map((t) => t.type))] as ("DSM" | "DTM")[],
    [tiffSelections]
  );

  const applyUploadResult = useCallback(
    async (result: UploadResult) => {
      setSessionId(result.session_id);
      setUploadResult(result);
      setTiffSelections(
        result.files.map((f) => ({ name: f.name, type: f.inferred_type === "DTM" ? "DTM" : "DSM" }))
      );

      revokeBlobUrls();
      setElevationOverlays([]);
      setElevationErrors({});

      const results = await Promise.all(
        result.files.map(async (f) => {
          const { url, error } = await fetchElevationImage(result.session_id, f.name);
          if (url) {
            blobUrlsRef.current.push(url);
            return {
              overlay: {
                url,
                bbox: f.bbox,
                filename: f.name,
                type: f.inferred_type,
              } as ElevationOverlay,
              errName: null,
              errMsg: null,
            };
          }
          return { overlay: null, errName: f.name, errMsg: error };
        })
      );

      setElevationOverlays(
        results.map((r) => r.overlay).filter((o): o is ElevationOverlay => o !== null)
      );
      const errMap: Record<string, string> = {};
      for (const r of results) {
        if (r.errName && r.errMsg) errMap[r.errName] = r.errMsg;
      }
      setElevationErrors(errMap);
    },
    [revokeBlobUrls]
  );

  const clearTerrain = useCallback(() => {
    revokeBlobUrls();
    setElevationOverlays([]);
    setElevationErrors({});
    setUploadResult(null);
    setSessionId(null);
    setTiffSelections([]);
  }, [revokeBlobUrls]);

  return {
    sessionId,
    uploadResult,
    tiffSelections,
    elevationOverlays,
    elevationErrors,
    availableTerrainTypes,
    applyUploadResult,
    clearTerrain,
  };
}
