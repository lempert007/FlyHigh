import { useState, useCallback } from "react";
import JSZip from "jszip";
import type { LatLon, Waypoint, Poi, FlightConfig, PlanMeta } from "../types/mission";
import { planRoute, buildRouteRequest } from "../api";

interface PlanInputs {
  sessionId: string | null;
  start: LatLon | null;
  waypoints: Waypoint[];
  pois: Poi[];
  flightConfig: FlightConfig;
  missionName: string;
  missionNotes: string;
  takeoffMode: "auto" | "fixed";
  takeoffAltM: number;
}

export interface PlanStep {
  phase: "terrain" | "route" | "altitude" | "safety" | "packaging";
  phaseLabel: string;
  msg: string;
}

export const PLAN_STEPS: PlanStep[] = [
  // Terrain
  {
    phase: "terrain",
    phaseLabel: "Loading Terrain",
    msg: "Opening raster tiles from session store",
  },
  {
    phase: "terrain",
    phaseLabel: "Loading Terrain",
    msg: "Reprojecting CRS → UTM coordinate frame",
  },
  { phase: "terrain", phaseLabel: "Loading Terrain", msg: "Building RegularGridInterpolator" },
  // Route geometry
  { phase: "route", phaseLabel: "Building Route", msg: "Tracing transit legs between waypoints" },
  { phase: "route", phaseLabel: "Building Route", msg: "Generating maneuver sweeps for each POI" },
  { phase: "route", phaseLabel: "Building Route", msg: "Inserting zone boundary crossings" },
  { phase: "route", phaseLabel: "Building Route", msg: "Expanding route to sample grid (20 m)" },
  // Altitude optimization
  {
    phase: "altitude",
    phaseLabel: "Altitude Optimization",
    msg: "Sampling terrain profile along full route",
  },
  {
    phase: "altitude",
    phaseLabel: "Altitude Optimization",
    msg: "Computing AGL floor/ceiling at each sample",
  },
  {
    phase: "altitude",
    phaseLabel: "Altitude Optimization",
    msg: "Backward floor propagation pass",
  },
  { phase: "altitude", phaseLabel: "Altitude Optimization", msg: "Forward floor propagation pass" },
  {
    phase: "altitude",
    phaseLabel: "Altitude Optimization",
    msg: "Forward ceiling propagation pass",
  },
  {
    phase: "altitude",
    phaseLabel: "Altitude Optimization",
    msg: "Backward ceiling propagation pass",
  },
  {
    phase: "altitude",
    phaseLabel: "Altitude Optimization",
    msg: "Selecting cruise altitudes (fewest changes)",
  },
  {
    phase: "altitude",
    phaseLabel: "Altitude Optimization",
    msg: "Inserting ramp waypoints along descents",
  },
  // Safety
  { phase: "safety", phaseLabel: "Safety Checks", msg: "Scanning surface clearance violations" },
  { phase: "safety", phaseLabel: "Safety Checks", msg: "Verifying AGL band compliance" },
  { phase: "safety", phaseLabel: "Safety Checks", msg: "Checking battery budget vs. route energy" },
  // Packaging
  { phase: "packaging", phaseLabel: "Packaging", msg: "Writing waypoints.json" },
  { phase: "packaging", phaseLabel: "Packaging", msg: "Generating mission_log.txt" },
  { phase: "packaging", phaseLabel: "Packaging", msg: "Assembling ZIP archive" },
];

console.assert(
  PLAN_STEPS.length === 21,
  `PLAN_STEPS has ${PLAN_STEPS.length} entries but expected 21`
);

// Cumulative ms delays for each step
const STEP_DELAYS = [
  0, 350, 750, 1200, 1800, 2500, 3300, 4200, 5000, 5700, 6300, 6900, 7500, 8200, 8900, 9500, 10000,
  10500, 11000, 11400, 11800,
];

interface UsePlanRouteReturn {
  isPlanning: boolean;
  planningStep: number | null;
  planError: string | null;
  clearPlanError: () => void;
  handlePlan: () => Promise<void>;
}

type OnSuccessCallback = (
  meta: PlanMeta | null,
  blob: Blob,
  routePoints: LatLon[],
  routeAglProfile: number[] | null
) => void;

export function usePlanRoute(inputs: PlanInputs, onSuccess: OnSuccessCallback): UsePlanRouteReturn {
  const [isPlanning, setIsPlanning] = useState(false);
  const [planningStep, setPlanningStep] = useState<number | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);

  const clearPlanError = useCallback(() => setPlanError(null), []);

  const handlePlan = useCallback(async () => {
    const {
      sessionId,
      start,
      pois,
      waypoints,
      flightConfig,
      missionName,
      missionNotes,
      takeoffMode,
      takeoffAltM,
    } = inputs;
    if (!sessionId || !start || pois.length === 0) return;

    setPlanError(null);
    setIsPlanning(true);
    setPlanningStep(0);

    const timers = STEP_DELAYS.slice(1).map((delay, i) =>
      setTimeout(() => setPlanningStep(i + 1), delay)
    );

    try {
      const request = buildRouteRequest({
        start,
        waypoints,
        pois,
        config: flightConfig,
        name: missionName,
        notes: missionNotes,
        takeoff_alt_m: takeoffMode === "fixed" ? Number(takeoffAltM) : undefined,
      });
      const { blob, meta } = await planRoute(sessionId, request);

      let routePoints: LatLon[] = [];
      let routeAglProfile: number[] | null = null;
      try {
        const zip = await JSZip.loadAsync(blob);
        const wpFile = zip.file("waypoints.json");
        if (wpFile) {
          const wps = JSON.parse(await wpFile.async("string")) as Array<{
            lat: number;
            lon: number;
          }>;
          routePoints = wps.map((w) => ({ lat: w.lat, lon: w.lon }));
        }
        const aglFile = zip.file("agl_profile.json");
        if (aglFile) {
          routeAglProfile = JSON.parse(await aglFile.async("string")) as number[];
        }
      } catch (zipErr) {
        if (import.meta.env.DEV) console.warn("ZIP parse failed (non-fatal):", zipErr);
      }

      onSuccess(meta, blob, routePoints, routeAglProfile);
    } catch (err) {
      setPlanError(err instanceof Error ? err.message : String(err));
    } finally {
      timers.forEach(clearTimeout);
      setIsPlanning(false);
      setPlanningStep(null);
    }
  }, [inputs, onSuccess]);

  return { isPlanning, planningStep, planError, clearPlanError, handlePlan };
}
