/**
 * Pure utility functions for the interactive altitude editor.
 *
 * Design rules:
 *  - No React, no side-effects — all functions are pure.
 *  - altNode indices correspond to positions in the sparse control array.
 *  - Dense waypoint reconstruction uses delta-interpolation to preserve
 *    the algorithm's terrain-following shape while shifting altitudes.
 */

import { haversineM } from "./math";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WpPoint {
  lat: number;
  lon: number;
  alt_m: number;
  action: string;
}

export type NodeType = "start" | "waypoint" | "poi" | "land" | "inserted";
export type ValidationStatus = "ok" | "below" | "above";

export interface AltNode {
  id: string;
  dist_m: number;
  alt_m: number;
  alt_m_original: number;
  type: NodeType;
  /** For POI nodes: actual cumulative distance at the START of the sweep block. */
  poi_start_dist_m?: number;
  /** For POI nodes: actual cumulative distance at the END of the sweep block. */
  poi_end_dist_m?: number;
}

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
 * Build per-point min/max AGL arrays from the global defaults and optional
 * POI-specific overrides. Points inside a POI band range use that band's values.
 */
export function buildAglBands(
  cumDists: number[],
  globalMin: number,
  globalMax: number,
  poiBands: PoiBand[],
): { minBand: number[]; maxBand: number[] } {
  const minBand = new Array<number>(cumDists.length).fill(globalMin);
  const maxBand = new Array<number>(cumDists.length).fill(globalMax);

  for (const pb of poiBands) {
    for (let i = 0; i < cumDists.length; i++) {
      if (cumDists[i] >= pb.start_m && cumDists[i] <= pb.end_m) {
        minBand[i] = pb.min_agl_m;
        maxBand[i] = pb.max_agl_m;
      }
    }
  }
  return { minBand, maxBand };
}

// ── Node building ─────────────────────────────────────────────────────────────

const POI_ACTIONS = new Set(["poi", "lawnmower", "warp_weft", "ramp_start"]);

/**
 * Build the initial sparse control-node array from the dense waypoint list.
 *
 * Rules:
 *  - Index 0 → "start" node
 *  - First point of each "waypoint" action group → "waypoint" node
 *  - First "poi" action of each POI block → "poi" node (covers the entire sweep)
 *  - Last "land" action → "land" node
 */
export function buildNodes(
  wps: WpPoint[],
  cumDists: number[],
  waypointIndices?: number[],
): AltNode[] {
  const nodes: AltNode[] = [];
  let idCounter = 0;
  const makeId = (type: NodeType) => `${type}_${idCounter++}`;
  // When provided, place handles at these exact dense-array indices instead of group starts
  const wpSet = waypointIndices?.length ? new Set(waypointIndices) : null;

  // Start node (always index 0)
  nodes.push({
    id: makeId("start"),
    dist_m: cumDists[0],
    alt_m: wps[0].alt_m,
    alt_m_original: wps[0].alt_m,
    type: "start",
  });

  let prevAction = wps[0].action;

  for (let i = 1; i < wps.length; i++) {
    const action = wps[i].action;
    const prevWasPoi      = POI_ACTIONS.has(prevAction);
    const currIsPoi       = POI_ACTIONS.has(action);
    const prevWasWaypoint = prevAction === "waypoint";
    const currIsWaypoint  = action === "waypoint";

    // Waypoint handle: per-index when list provided, else per group-start (fallback)
    const isWaypointHandle = wpSet ? wpSet.has(i) : (currIsWaypoint && !prevWasWaypoint);
    if (isWaypointHandle) {
      nodes.push({
        id: makeId("waypoint"),
        dist_m: cumDists[i],
        alt_m: wps[i].alt_m,
        alt_m_original: wps[i].alt_m,
        type: "waypoint",
      });
    }

    // Start of a POI sweep block (first "poi" action after a non-poi action)
    if (action === "poi" && !prevWasPoi) {
      const blockStart = i;

      // Find the end of this POI block
      let blockEnd = i;
      while (blockEnd + 1 < wps.length && POI_ACTIONS.has(wps[blockEnd + 1].action)) {
        blockEnd++;
      }

      // Place the handle at the midpoint of the block
      const midIdx = Math.round((blockStart + blockEnd) / 2);

      nodes.push({
        id: makeId("poi"),
        dist_m: cumDists[midIdx],
        alt_m: wps[midIdx].alt_m,
        alt_m_original: wps[midIdx].alt_m,
        type: "poi",
        poi_start_dist_m: cumDists[blockStart],
        poi_end_dist_m: cumDists[blockEnd],
      });
    }

    // Landing node
    if (action === "land" && i === wps.length - 1) {
      nodes.push({
        id: makeId("land"),
        dist_m: cumDists[i],
        alt_m: wps[i].alt_m,
        alt_m_original: wps[i].alt_m,
        type: "land",
      });
    }

    prevAction = action;
  }

  nodes.sort((a, b) => a.dist_m - b.dist_m);
  return nodes;
}

// ── Altitude reconstruction ───────────────────────────────────────────────────

/**
 * Reconstruct the full dense altitude array from sparse control nodes.
 *
 * Uses delta-interpolation: the original terrain-following shape is preserved
 * and a linear ramp of altitude *deltas* is applied between consecutive nodes.
 * This means dragging a segment only violates the AGL band when the drone
 * genuinely gets too close to terrain — there are no "false" violations caused
 * by a straight-line approximation missing a terrain peak mid-segment.
 *
 * For POI blocks: a uniform delta is applied to all points within the block
 * so the sweep's internal shape stays intact.
 */
export function reconstructAltitudes(
  nodes: AltNode[],
  wps: WpPoint[],
  cumDists: number[],
): number[] {
  if (nodes.length === 0) return wps.map((w) => w.alt_m);

  const sorted = [...nodes].sort((a, b) => a.dist_m - b.dist_m);
  const nodeDists = sorted.map((n) => n.dist_m);

  // Precompute POI ranges once — O(K) — avoids re-scanning per waypoint
  const poiRanges = sorted
    .filter(
      (n): n is AltNode & { poi_start_dist_m: number; poi_end_dist_m: number } =>
        n.type === "poi" &&
        n.poi_start_dist_m !== undefined &&
        n.poi_end_dist_m !== undefined,
    )
    .map((n) => ({ start: n.poi_start_dist_m, end: n.poi_end_dist_m, delta: n.alt_m - n.alt_m_original }));

  const result = new Array<number>(wps.length);

  for (let i = 0; i < wps.length; i++) {
    const d = cumDists[i];

    // POI block — uniform delta preserves the sweep's internal shape
    // P (num POIs) is always tiny, so this inner loop is negligible
    let inPoi = false;
    for (const pr of poiRanges) {
      if (d >= pr.start && d <= pr.end) {
        result[i] = wps[i].alt_m + pr.delta;
        inPoi = true;
        break;
      }
    }
    if (inPoi) continue;

    // Transit point — binary search for bounding nodes — O(log K)
    let lo = 0, hi = sorted.length - 1, jA = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (nodeDists[mid] <= d) { jA = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    const jB = Math.min(jA + 1, sorted.length - 1);
    const nodeA = sorted[jA];
    const nodeB = sorted[jB];

    const span   = nodeB.dist_m - nodeA.dist_m;
    const t      = span > 0 ? (d - nodeA.dist_m) / span : 0;
    const deltaA = nodeA.alt_m - nodeA.alt_m_original;
    const deltaB = nodeB.alt_m - nodeB.alt_m_original;
    result[i]    = wps[i].alt_m + deltaA + (deltaB - deltaA) * t;
  }

  return result;
}

// ── Validation ────────────────────────────────────────────────────────────────

/**
 * Check each reconstructed altitude against the per-point AGL band.
 * Returns per-waypoint status: "ok", "below" (< minBand), or "above" (> maxBand).
 *
 * minBand and maxBand are per-point arrays (from buildAglBands), giving
 * accurate results even when POI zones have custom AGL overrides.
 */
export function validateAltitudes(
  reconAlt: number[],
  terrain: number[],
  minBand: number[],
  maxBand: number[],
): ValidationStatus[] {
  return reconAlt.map((alt, i) => {
    const agl = alt - terrain[i];
    // agl < 0 means terrain is above the drone — this is a backend sentinel
    // value (safe_fill) used for points outside the terrain raster. Skip them.
    if (agl < 0) return "ok";
    if (agl < minBand[i]) return "below";
    if (agl > maxBand[i]) return "above";
    return "ok";
  });
}

// ── Node insertion ────────────────────────────────────────────────────────────

/**
 * Find the interpolated altitude at a given cumulative distance.
 * Used to set a sensible default when inserting a new node.
 */
export function interpolateAltAtDist(
  nodes: AltNode[],
  wps: WpPoint[],
  cumDists: number[],
  dist_m: number,
): number {
  let closest = 0;
  let minDiff = Infinity;
  for (let i = 0; i < cumDists.length; i++) {
    const diff = Math.abs(cumDists[i] - dist_m);
    if (diff < minDiff) { minDiff = diff; closest = i; }
  }
  const reconAlt = reconstructAltitudes(nodes, wps, cumDists);
  return reconAlt[closest];
}
