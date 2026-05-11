import { useState, useEffect, useRef } from "react";
import type { LatLon, Waypoint, Poi, FlightConfig } from "../types/mission";
import { haversineM } from "../utils/math";
import { LIVE_ESTIMATE_DEBOUNCE_MS } from "../constants";

export interface LiveEstimates {
  totalEstDistanceM: number;
  estFlightTimeSec: number;
}

/** Approximate sweep distance for a single POI (no terrain, no zone effects). */
function estimateSweepDistanceM(poi: Poi): number {
  const { maneuver } = poi;
  if (maneuver.sweep_spacing_m <= 0) return 0;
  const factor = maneuver.type === "warp_weft" ? 2 : 1;

  if (maneuver.polygon && maneuver.polygon.length >= 3) {
    // Shoelace polygon area → divide by sweep spacing to get total strip length
    const verts = maneuver.polygon;
    const meanLat = verts.reduce((s, v) => s + v.lat, 0) / verts.length;
    const METERS_PER_DEGREE = 111_320;
    const latScale = METERS_PER_DEGREE;
    const lonScale = METERS_PER_DEGREE * Math.cos((meanLat * Math.PI) / 180);
    const pts = verts.map((v) => [v.lon * lonScale, v.lat * latScale]);
    let area = 0;
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      area += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1];
    }
    const areaM2 = Math.abs(area) / 2;
    return (areaM2 / maneuver.sweep_spacing_m) * factor;
  }

  const strips = Math.ceil((maneuver.width_m || 100) / maneuver.sweep_spacing_m);
  return strips * (maneuver.height_m || 100) * factor;
}

/**
 * Computes rough before-planning estimates in-browser with debouncing.
 * Returns null when there are no meaningful points to estimate from.
 */
export function useLiveEstimates(
  start: LatLon | null,
  waypoints: Waypoint[],
  pois: Poi[],
  config: FlightConfig
): LiveEstimates | null {
  const [estimates, setEstimates] = useState<LiveEstimates | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);

    if (!start && waypoints.length === 0 && pois.length === 0) {
      setEstimates(null);
      return;
    }

    timer.current = setTimeout(() => {
      // Build chain: start → waypoints → POI centres → back to start
      const chain: LatLon[] = [];
      if (start) chain.push(start);
      chain.push(...waypoints);
      chain.push(...pois.map((p) => p.point));
      if (start) chain.push(start);

      let transitDistM = 0;
      for (let i = 1; i < chain.length; i++) transitDistM += haversineM(chain[i - 1], chain[i]);

      const sweepDistM = pois.reduce((sum, poi) => sum + estimateSweepDistanceM(poi), 0);
      const totalEstDistanceM = transitDistM + sweepDistM;

      const speed = config.cruise_speed_ms > 0 ? config.cruise_speed_ms : 8;
      const estFlightTimeSec = totalEstDistanceM / speed;

      setEstimates({ totalEstDistanceM, estFlightTimeSec });
    }, LIVE_ESTIMATE_DEBOUNCE_MS);

    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [start, waypoints, pois, config]);

  return estimates;
}
