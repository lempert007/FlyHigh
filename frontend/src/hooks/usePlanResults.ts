/**
 * Manages plan result state: PlanMeta, ZIP blob, rendered route points,
 * and AGL profile. Also handles async restore from a saved mission folder.
 *
 * Extracted from App.tsx to keep plan-result concerns isolated.
 */

import { useState, useCallback } from "react";
import type { LatLon, PlanMeta } from "../types/mission";
import { fetchMissionPlan } from "../api";

export interface PlanResultsState {
  planMeta: PlanMeta | null;
  zipBlob: Blob | null;
  routePoints: LatLon[];
  routeAglProfile: number[] | null;
  setPlanMeta: (meta: PlanMeta | null) => void;
  setZipBlob: (blob: Blob | null) => void;
  setRoutePoints: (pts: LatLon[]) => void;
  setRouteAglProfile: (profile: number[] | null) => void;
  /** Clear all plan results (called when terrain changes or mission resets). */
  clearPlan: () => void;
  /**
   * Restore plan meta immediately from saved state, then fetch ZIP async.
   * Calls onZipFail if the ZIP can't be fetched.
   */
  restorePlan: (folder: string, savedMeta: PlanMeta, onZipFail?: () => void) => void;
}

export function usePlanResults(): PlanResultsState {
  const [planMeta, setPlanMeta] = useState<PlanMeta | null>(null);
  const [zipBlob, setZipBlob] = useState<Blob | null>(null);
  const [routePoints, setRoutePoints] = useState<LatLon[]>([]);
  const [routeAglProfile, setRouteAglProfile] = useState<number[] | null>(null);

  const clearPlan = useCallback(() => {
    setPlanMeta(null);
    setZipBlob(null);
    setRoutePoints([]);
    setRouteAglProfile(null);
  }, []);

  const restorePlan = useCallback((folder: string, savedMeta: PlanMeta, onZipFail?: () => void) => {
    setPlanMeta(savedMeta);
    fetchMissionPlan(folder)
      .then(({ blob, routePoints: rpts, aglProfile }) => {
        setZipBlob(blob);
        setRoutePoints(rpts);
        setRouteAglProfile(aglProfile);
      })
      .catch(() => onZipFail?.());
  }, []);

  return {
    planMeta,
    zipBlob,
    routePoints,
    routeAglProfile,
    setPlanMeta,
    setZipBlob,
    setRoutePoints,
    setRouteAglProfile,
    clearPlan,
    restorePlan,
  };
}
