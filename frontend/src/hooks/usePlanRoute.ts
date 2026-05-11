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
  // ── Terrain loading ──────────────────────────────────────────────────────────
  // The uploaded GeoTIFF is opened from the in-memory session store, reprojected
  // from its source CRS (WGS84 or projected) into a UTM zone, then wrapped in a
  // RegularGridInterpolator so any (easting, northing) query is O(log n).
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
  {
    phase: "terrain",
    phaseLabel: "Loading Terrain",
    msg: "Building terrain interpolator",
  },
  // ── 2-D route geometry ───────────────────────────────────────────────────────
  // The mission is assembled as a flat list of (lat, lon, action) points:
  // start → transit waypoints → lawnmower/warp-weft sweeps per POI → landing.
  { phase: "route", phaseLabel: "Building Route", msg: "Tracing transit legs between waypoints" },
  { phase: "route", phaseLabel: "Building Route", msg: "Generating maneuver sweeps for each POI" },
  // Wherever the path crosses from outside a POI zone into its interior (or back),
  // a waypoint is inserted on the boundary so each leg belongs to exactly one band.
  {
    phase: "route",
    phaseLabel: "Building Route",
    msg: "Inserting band-change waypoints at zone boundaries",
  },
  // If any leg spans terrain whose peak − valley > max_agl − min_agl, no single
  // cruise altitude can satisfy both min and max AGL simultaneously. The leg is
  // bisected recursively (up to 3 levels) so each half has a feasible band.
  {
    phase: "route",
    phaseLabel: "Building Route",
    msg: "Splitting legs where terrain variation exceeds AGL band",
  },
  // ── Altitude optimization (9-step engine) ────────────────────────────────────
  // For every leg, the safety bubble ribbon (10 lateral + forward directions) is
  // sampled to find the worst-case terrain peak (floor reference) and the DTM
  // valley (ceiling reference). floor = peak + min_agl, ceiling = valley + max_agl.
  {
    phase: "altitude",
    phaseLabel: "Altitude Optimization",
    msg: "Sampling bubble-ribbon terrain floor and ceiling per leg",
  },
  // Four O(n) passes propagate the slope constraint (max climb_rate / cruise_speed)
  // forward and backward through the leg sequence, tightening the [floor, ceiling]
  // interval at each leg so that a slope-feasible sequence always exists.
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
  // A single forward pass selects the cruise altitude for each leg: hold current
  // altitude unless the floor forces a climb or the ceiling forces a descent.
  {
    phase: "altitude",
    phaseLabel: "Altitude Optimization",
    msg: "Selecting cruise altitudes (fewest changes)",
  },
  // Each altitude change is executed on a ramp at the configured climb slope.
  // A ramp_start waypoint is inserted so the drone cruises flat, then climbs or
  // descends, arriving at the new altitude exactly at the next key waypoint.
  {
    phase: "altitude",
    phaseLabel: "Altitude Optimization",
    msg: "Inserting ramp waypoints for climbs and descents",
  },
  // During ramps, the linearly-interpolated altitude can dip below the bubble disc
  // on hill approaches. The worst violation per ramp segment gets a ramp_pin
  // waypoint inserted to pin the ramp above terrain.
  {
    phase: "altitude",
    phaseLabel: "Altitude Optimization",
    msg: "Inserting terrain-pin corrections on ramp segments",
  },
  // ── Safety validation ────────────────────────────────────────────────────────
  // Three independent checks on the final dense route (one point every spacing_m):
  // 1. Vertical: drone MSL ≥ DSM surface at every point.
  // 2. Bubble disc: drone MSL ≥ peak terrain within point_radius_m in all directions.
  // 3. Camera range: drone AGL ≤ max_agl above the lowest surface within max_surface_radius_m.
  { phase: "safety", phaseLabel: "Safety Checks", msg: "Checking vertical surface clearance" },
  {
    phase: "safety",
    phaseLabel: "Safety Checks",
    msg: "Verifying safety bubble disc compliance",
  },
  { phase: "safety", phaseLabel: "Safety Checks", msg: "Checking camera AGL band compliance" },
  // ── Packaging ────────────────────────────────────────────────────────────────
  // Waypoints are densified to spacing_m, energy and flight time are estimated,
  // then all outputs are bundled into a ZIP.
  {
    phase: "packaging",
    phaseLabel: "Packaging",
    msg: "Densifying waypoints and estimating energy",
  },
  { phase: "packaging", phaseLabel: "Packaging", msg: "Writing waypoints.json" },
  { phase: "packaging", phaseLabel: "Packaging", msg: "Generating mission_log.txt" },
  { phase: "packaging", phaseLabel: "Packaging", msg: "Assembling ZIP archive" },
];

console.assert(
  PLAN_STEPS.length === 22,
  `PLAN_STEPS has ${PLAN_STEPS.length} entries but expected 22`
);

// Cumulative delay (ms) at which each step label becomes visible.
// Tuned to feel realistic for a typical ~20 s planning run.
// Planning always wins: if the fetch completes early, all timers are cancelled.
const STEP_DELAYS: number[] = [
  0, // 0  Opening raster tiles
  400, // 1  Reprojecting CRS
  1200, // 2  Building RegularGridInterpolator
  1900, // 3  Tracing transit legs
  2600, // 4  Generating maneuver sweeps
  3300, // 5  Inserting zone boundary crossings
  4100, // 6  Expanding route to sample grid
  5000, // 7  Sampling terrain profile
  5900, // 8  Computing AGL floor/ceiling
  6600, // 9  Backward floor propagation
  7200, // 10 Forward floor propagation
  7800, // 11 Forward ceiling propagation
  8400, // 12 Backward ceiling propagation
  9000, // 13 Selecting cruise altitudes
  9800, // 14 Inserting ramp waypoints
  10800, // 15 Scanning surface clearance
  11600, // 16 Verifying AGL band compliance
  12400, // 17 Densifying waypoints
  14000, // 19 Writing waypoints.json
  14800, // 20 Generating mission_log.txt
  15600, // 21 Assembling ZIP archive
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

    // Fire fake progress timers while the real fetch runs in parallel.
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
