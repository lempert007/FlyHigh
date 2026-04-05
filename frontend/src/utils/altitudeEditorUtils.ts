/**
 * Pure utility functions for the interactive altitude editor.
 *
 * Design rules:
 *  - No React, no side-effects — all functions are pure.
 *  - Dense waypoint reconstruction uses delta-interpolation to preserve
 *    the algorithm's terrain-following shape while shifting altitudes.
 */

import { haversineM } from "./math";
import { SegmentType } from "../types/mission";
import type { ProfilePoint } from "../types/mission";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WpPoint {
  lat: number;
  lon: number;
  alt_m: number;
  action: string;
}

export type ValidationStatus = "ok" | "below" | "above";

/** A segment where a custom AGL band applies (from poi_bands.json). */
export interface PoiBand {
  start_m: number;
  end_m: number;
  min_agl_m: number;
  max_agl_m: number;
}

// ── Cumulative distances ──────────────────────────────────────────────────────

/** Compute cumulative haversine distances (metres) for an array of waypoints. */
export function buildCumDists(wps: WpPoint[]): number[] {
  const out: number[] = [0];
  for (let i = 1; i < wps.length; i++) {
    out.push(out[i - 1] + haversineM(wps[i - 1], wps[i]));
  }
  return out;
}

// ── Per-point AGL band ────────────────────────────────────────────────────────

/**
 * Build per-point min/max AGL band arrays (as AGL offsets above terrain[i]).
 */
export function buildAglBands(
  cumDists: number[],
  terrain: number[],
  globalMin: number,
  globalMax: number,
  poiBands: PoiBand[],
  bubblePeakTerrain?: number[] | null,
  cameraMinTerrain?: number[] | null
): { minBand: number[]; maxBand: number[] } {
  const n = cumDists.length;

  // Precompute per-point offsets above terrain for the safety bubble and camera references.
  // When the reference equals terrain (no special array provided), offset is 0.
  const floorOffset = bubblePeakTerrain
    ? bubblePeakTerrain.map((v, i) => v - terrain[i])
    : new Array<number>(n).fill(0);
  const ceilOffset = cameraMinTerrain
    ? cameraMinTerrain.map((v, i) => v - terrain[i])
    : new Array<number>(n).fill(0);

  const minBand = floorOffset.map((f) => f + globalMin);
  const maxBand = ceilOffset.map((c) => c + globalMax);

  for (const pb of poiBands) {
    for (let i = 0; i < n; i++) {
      if (cumDists[i] >= pb.start_m && cumDists[i] <= pb.end_m) {
        minBand[i] = floorOffset[i] + pb.min_agl_m;
        maxBand[i] = ceilOffset[i] + pb.max_agl_m;
      }
    }
  }
  return { minBand, maxBand };
}

// ── Validation ────────────────────────────────────────────────────────────────

/**
 * Check each altitude against the per-point AGL band.
 * Returns per-waypoint status: "ok", "below" (< minBand), or "above" (> maxBand).
 */
export function validateAltitudes(
  alts: number[],
  terrain: number[],
  minBand: number[],
  maxBand: number[]
): ValidationStatus[] {
  return alts.map((alt, i) => {
    const agl = alt - terrain[i];
    if (agl < 0) return "ok"; // sentinel: outside raster
    if (agl < minBand[i]) return "below";
    if (agl > maxBand[i]) return "above";
    return "ok";
  });
}

// ── Zone shapes for Plotly ────────────────────────────────────────────────────

const ZONE_COLORS: Record<SegmentType, string> = {
  [SegmentType.TRANSIT]: "rgba(0,0,0,0)",
  [SegmentType.POI_SCAN]: "rgba(255,200,50,0.12)",
  [SegmentType.WAYPOINT]: "rgba(120,255,120,0.10)",
};

export interface PlotlyShape {
  type: "rect";
  xref: "x";
  yref: "paper";
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  fillcolor: string;
  line: { width: number };
  layer: "below";
}

/**
 * Build Plotly layout shape rectangles that colour-code zone segments.
 * Consecutive points with the same zone type are merged into one rectangle.
 */
export function buildZoneShapes(profilePoints: ProfilePoint[]): PlotlyShape[] {
  if (profilePoints.length === 0) return [];

  const shapes: PlotlyShape[] = [];
  let zoneStart = 0;
  let currentType: SegmentType = profilePoints[0].segment_type;

  const pushShape = (startIdx: number, endIdx: number, type: SegmentType) => {
    const color = ZONE_COLORS[type];
    if (color === "rgba(0,0,0,0)") return; // skip transparent transit segments
    shapes.push({
      type: "rect",
      xref: "x",
      yref: "paper",
      x0: profilePoints[startIdx].dist_m,
      x1: profilePoints[endIdx].dist_m,
      y0: 0,
      y1: 1,
      fillcolor: color,
      line: { width: 0 },
      layer: "below",
    });
  };

  for (let i = 1; i < profilePoints.length; i++) {
    const type = profilePoints[i].segment_type;
    if (type !== currentType) {
      pushShape(zoneStart, i - 1, currentType);
      zoneStart = i;
      currentType = type;
    }
  }
  pushShape(zoneStart, profilePoints.length - 1, currentType);

  return shapes;
}
