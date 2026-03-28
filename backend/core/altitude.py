"""
Piecewise-linear altitude profile engine.

This is the heart of the redesign. The only module that makes altitude decisions.

Profile geometry: flat legs at constant MSL altitude joined by ramps at a fixed
climb slope. A ramp always ends AT the waypoint where the new altitude begins.

Algorithm overview (9 steps):
  1. Resolve start altitude.
  2a. Insert zone-crossing waypoints (single band per leg).
  2b. Split impossible-band legs recursively (up to depth 3).
  3. Compute per-leg [floor, ceiling, length].
  4. Propagate slope constraints → effective [eff_lo, eff_hi] intervals (4 O(n) passes).
  5. Select cruise altitude via simple forward clamp (fewest altitude changes).
  6. Clamp start altitude.
  7. Insert ramp waypoints (always fits after Step 4 propagation).
  8. Ramp terrain pins — ensure min AGL on every ramp segment.
  9. Validate AGL (both min and max) along every segment.
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass

import config as _config
from core.band import band_at, find_zone_crossings
from core.terrain import TerrainIndex
from core.types import (
    AltitudeBand,
    FlightParams,
    LatLon,
    PoiZone,
    Violation,
    ViolationTier,
    Waypoint3D,
)

logger = logging.getLogger(__name__)


@dataclass
class AltitudeProfileResult:
    key_waypoints_3d: list[Waypoint3D]
    violations: list[Violation]


# ── Leg-level helpers ──────────────────────────────────────────────────────────


def compute_ramp_distance_m(delta_alt_m: float, params: FlightParams) -> float:
    """Return the horizontal distance required to transition delta_alt_m at max slope."""
    return abs(delta_alt_m) / params.max_climb_slope


def _leg_length_m(start: LatLon, end: LatLon) -> float:
    """Approximate great-circle leg length in metres using flat-earth projection."""
    dlat = end.lat - start.lat
    dlon = end.lon - start.lon
    lat_m = 111_320.0
    lon_m = 111_320.0 * math.cos(math.radians((start.lat + end.lat) / 2))
    return math.hypot(dlat * lat_m, dlon * lon_m)


def _interpolate_point(start: LatLon, end: LatLon, distance_m: float, total_m: float) -> LatLon:
    """Linear interpolation between two LatLon points at a given distance."""
    if total_m < 1e-9:
        return start
    t = max(0.0, min(1.0, distance_m / total_m))
    return LatLon(
        lat=start.lat + t * (end.lat - start.lat),
        lon=start.lon + t * (end.lon - start.lon),
    )


def _midpoint(a: LatLon, b: LatLon) -> LatLon:
    return LatLon(lat=(a.lat + b.lat) / 2, lon=(a.lon + b.lon) / 2)


# ── Step 2b: Recursive terrain splitter ───────────────────────────────────────


def _split_impossible_legs(
    points: list[LatLon],
    actions: list[str],
    poi_zones: list[PoiZone],
    global_band: AltitudeBand,
    terrain: TerrainIndex,
    spacing: float,
    bubble_terrain: TerrainIndex | None = None,
    bubble_radius_m: float = 0.0,
) -> tuple[list[LatLon], list[str]]:
    """Insert midpoints wherever terrain variation exceeds band width (up to depth 3).

    Returns a new (points, actions) pair where every leg is either feasible or has
    been split to the recursion limit.  The first element of points is unchanged.
    """
    result_pts: list[LatLon] = [points[0]]
    result_acts: list[str] = [actions[0]]

    for i in range(1, len(points)):
        new_pts, new_acts = _try_split(
            points[i - 1],
            points[i],
            actions[i],
            poi_zones,
            global_band,
            terrain,
            spacing,
            depth=0,
            bubble_terrain=bubble_terrain,
            bubble_radius_m=bubble_radius_m,
        )
        result_pts.extend(new_pts)
        result_acts.extend(new_acts)

    return result_pts, result_acts


def _try_split(
    start: LatLon,
    end: LatLon,
    action: str,
    poi_zones: list[PoiZone],
    global_band: AltitudeBand,
    terrain: TerrainIndex,
    spacing: float,
    depth: int,
    bubble_terrain: TerrainIndex | None = None,
    bubble_radius_m: float = 0.0,
) -> tuple[list[LatLon], list[str]]:
    """Recursively split [start, end] until the leg is feasible or depth >= 3.

    Uses bubble_terrain with ribbon sampling for the peak (matching Step 3) so
    the feasibility check is consistent with the floor computation — preventing
    legs that pass this check from still triggering an impossible-band violation
    in Step 3.

    Returns the *suffix* — the list of points from the first inserted split to end
    (never includes start itself).
    """
    band = band_at(_midpoint(start, end), poi_zones, global_band)
    profile = terrain.sample_leg(start, end, spacing)
    valley = profile.valley_elevation_msl()

    if bubble_terrain is not None and bubble_radius_m > 0:
        peak = bubble_terrain.sample_ribbon_peak(start, end, spacing, bubble_radius_m)
        if math.isnan(peak):
            peak = profile.peak_elevation_msl()
    else:
        peak = profile.peak_elevation_msl()

    # Feasibility: floor ≤ ceiling  →  terrain_peak + min_agl ≤ terrain_valley + max_agl
    if peak + band.min_agl_m <= valley + band.max_agl_m:
        return [end], [action]

    if depth >= 3:
        return [end], [action]  # give up; impossible-band violation recorded in Step 3

    mid = _midpoint(start, end)
    left_pts, left_acts = _try_split(
        start,
        mid,
        "terrain_split",
        poi_zones,
        global_band,
        terrain,
        spacing,
        depth + 1,
        bubble_terrain=bubble_terrain,
        bubble_radius_m=bubble_radius_m,
    )
    right_pts, right_acts = _try_split(
        mid,
        end,
        action,
        poi_zones,
        global_band,
        terrain,
        spacing,
        depth + 1,
        bubble_terrain=bubble_terrain,
        bubble_radius_m=bubble_radius_m,
    )
    return left_pts + right_pts, left_acts + right_acts


# ── Step 8: Ramp terrain pins ─────────────────────────────────────────────────


def _insert_ramp_pins(
    result_points: list[LatLon],
    result_altitudes: list[float],
    result_actions: list[str],
    terrain: TerrainIndex,
    poi_zones: list[PoiZone],
    global_band: AltitudeBand,
    spacing: float,
    bubble_terrain: TerrainIndex | None = None,
    point_radius_m: float = 0.0,
) -> None:
    """Insert waypoints on ramp segments where linear interpolation violates min AGL.

    When bubble_terrain is supplied, terrain peaks are taken from a lateral ribbon of
    width point_radius_m rather than just the path centerline, matching the disc-based
    safety check semantics.

    Works in-place.  Safety cap: total waypoints are limited to initial count + 500
    to prevent degenerate infinite loops.
    """
    safety_limit = len(result_points) + 500
    i = 1
    while i < len(result_points) and len(result_points) < safety_limit:
        # Only ramp segments need terrain pinning; flat segments are handled by Step 3.
        if abs(result_altitudes[i] - result_altitudes[i - 1]) < 0.01:
            i += 1
            continue

        seg_len = _leg_length_m(result_points[i - 1], result_points[i])
        if seg_len < spacing:
            i += 1
            continue

        if bubble_terrain is not None and point_radius_m > 0:
            profile = bubble_terrain.sample_ribbon(
                result_points[i - 1], result_points[i], spacing, point_radius_m
            )
        else:
            profile = terrain.sample_leg(result_points[i - 1], result_points[i], spacing)
        band = band_at(_midpoint(result_points[i - 1], result_points[i]), poi_zones, global_band)

        # Find the worst terrain clearance violation on this ramp segment.
        worst_d: float | None = None
        worst_elev: float = 0.0
        worst_viol: float = 0.0

        for s in profile.samples:
            t = s.distance_m / max(seg_len, 1e-6)
            drone_alt = result_altitudes[i - 1] + t * (
                result_altitudes[i] - result_altitudes[i - 1]
            )
            viol = band.min_agl_m - (drone_alt - s.elevation_msl)
            if viol > _config.AGL_VALIDATION_EPSILON_M and viol > worst_viol:
                worst_d, worst_elev, worst_viol = s.distance_m, s.elevation_msl, viol

        if worst_d is None:
            i += 1
            continue  # ramp clears terrain

        # Insert a terrain-pin waypoint at the worst point.
        pin_pt = _interpolate_point(result_points[i - 1], result_points[i], worst_d, seg_len)
        pin_alt = worst_elev + band.min_agl_m
        result_points.insert(i, pin_pt)
        result_altitudes.insert(i, pin_alt)
        result_actions.insert(i, "ramp_pin")
        # Re-check from i-1 → new pin (don't advance i).


# ── Main profile engine ────────────────────────────────────────────────────────


def plan_altitude_profile(
    waypoints_2d: list[LatLon],
    waypoint_actions: list[str],
    terrain_dtm: TerrainIndex,
    poi_zones: list[PoiZone],
    global_band: AltitudeBand,
    params: FlightParams,
    bubble_terrain: TerrainIndex | None = None,
) -> AltitudeProfileResult:
    """Build the full 3-D altitude profile for the mission."""
    violations: list[Violation] = []

    if not waypoints_2d:
        return AltitudeProfileResult(key_waypoints_3d=[], violations=violations)

    # ── Step 1: Resolve start altitude ────────────────────────────────────────
    if params.takeoff_alt_msl is not None:
        start_alt = params.takeoff_alt_msl
        logger.info("Start altitude pinned to %.1f m MSL (user-specified)", start_alt)
    else:
        start_elev = terrain_dtm.elevation_at(waypoints_2d[0])
        if math.isnan(start_elev):
            logger.warning(
                "Terrain lookup returned NaN at start point (%.6f, %.6f) — "
                "falling back to 0.0 m MSL. Check that the start point is inside the DEM extent.",
                waypoints_2d[0].lat,
                waypoints_2d[0].lon,
            )
            start_elev = 0.0
        # Use the disc peak at the start point (same reference as the safety checker)
        # so the start altitude already satisfies the horizontal bubble check.
        if bubble_terrain is not None and params.point_radius_m > 0:
            disc_peak = bubble_terrain.disc_peak_at(waypoints_2d[0], params.point_radius_m)
            if not math.isnan(disc_peak):
                start_elev = max(start_elev, disc_peak)
        start_alt = start_elev + global_band.min_agl_m + 1.0
        logger.info(
            "Start altitude auto-derived: %.1f m MSL (disc_peak %.1f + min_agl %.1f + 1.0 spare)",
            start_alt,
            start_elev,
            global_band.min_agl_m,
        )

    # Finer spacing for terrain peak/valley sampling — use terrain's own resolution so we
    # never miss features the DEM can represent.  Cap at FLAT_LEG_SAMPLE_SPACING_M as an
    # upper bound (never coarser than that), but honour the raster's native cell size.
    floor_spacing = min(
        params.spacing_m, _config.FLAT_LEG_SAMPLE_SPACING_M, terrain_dtm.resolution_m
    )

    # ── Step 2a: Insert zone-crossing waypoints ────────────────────────────────
    expanded_points: list[LatLon] = [waypoints_2d[0]]
    expanded_actions: list[str] = [waypoint_actions[0]]

    for i in range(1, len(waypoints_2d)):
        leg_start = waypoints_2d[i - 1]
        leg_end = waypoints_2d[i]
        crossings = find_zone_crossings(
            leg_start,
            leg_end,
            poi_zones,
            global_band,
            spacing_m=params.spacing_m,
        )
        for crossing in crossings:
            expanded_points.append(crossing.point)
            expanded_actions.append("zone_crossing")
        expanded_points.append(leg_end)
        expanded_actions.append(waypoint_actions[i])

    # ── Step 2b: Split impossible-band legs ────────────────────────────────────
    expanded_points, expanded_actions = _split_impossible_legs(
        expanded_points,
        expanded_actions,
        poi_zones,
        global_band,
        terrain_dtm,
        floor_spacing,
        bubble_terrain=bubble_terrain,
        bubble_radius_m=params.point_radius_m,
    )

    n = len(expanded_points)

    # ── Step 3: Compute per-leg floor, ceiling, length ─────────────────────────
    # floor[i] = terrain_peak + min_agl  (minimum allowed cruise altitude)
    # ceiling[i] = terrain_valley + max_agl  (maximum allowed cruise altitude)
    # Both derived from the same terrain sample so Step 2b guarantees floor ≤ ceiling.
    leg_floors: list[float] = []
    leg_ceilings: list[float] = []
    leg_lengths: list[float] = []
    leg_max_d: list[float] = []  # max altitude delta achievable per leg

    for i in range(n - 1):
        leg_s = expanded_points[i]
        leg_e = expanded_points[i + 1]
        mid = _midpoint(leg_s, leg_e)
        active_band = band_at(mid, poi_zones, global_band)

        profile = terrain_dtm.sample_leg(leg_s, leg_e, floor_spacing)
        terrain_valley = profile.valley_elevation_msl()

        # Floor: use bubble_terrain with lateral ribbon sampling when available so
        # the optimizer accounts for terrain within the safety disc (not just directly
        # below the path).  This prevents the safety checker from firing violations
        # that the optimizer never considered.
        if bubble_terrain is not None and params.point_radius_m > 0:
            terrain_peak = bubble_terrain.sample_ribbon_peak(
                leg_s, leg_e, floor_spacing, params.point_radius_m
            )
            if math.isnan(terrain_peak):
                terrain_peak = profile.peak_elevation_msl()
        else:
            terrain_peak = profile.peak_elevation_msl()

        lo = terrain_peak + active_band.min_agl_m
        hi = terrain_valley + active_band.max_agl_m

        if lo > hi:
            # Depth-limit reached in Step 2b — terrain variation still exceeds band width.
            logger.warning(
                "Impossible flat-leg band on leg %d→%d: terrain Δ=%.1f m, band width=%.1f m",
                i,
                i + 1,
                terrain_peak - terrain_valley,
                active_band.max_agl_m - active_band.min_agl_m,
            )
            violations.append(
                Violation(
                    tier=ViolationTier.HARD,
                    kind="terrain_band",
                    location=mid,
                    message=(
                        f"Terrain variation ({terrain_peak - terrain_valley:.0f} m) exceeds AGL band "
                        f"({active_band.max_agl_m - active_band.min_agl_m:.0f} m) on leg {i}→{i + 1}. "
                        f"Drone satisfies min AGL above the peak but will exceed max AGL above valleys — "
                        f"widen the AGL band or re-route to avoid this terrain."
                    ),
                    measured_value=terrain_peak - terrain_valley,
                    limit_value=active_band.max_agl_m - active_band.min_agl_m,
                )
            )
            hi = lo  # safety: fly at floor

        leg_len = _leg_length_m(leg_s, leg_e)
        leg_floors.append(lo)
        leg_ceilings.append(hi)
        leg_lengths.append(leg_len)
        leg_max_d.append(leg_len * params.max_climb_slope)

    if not leg_floors:
        key_wps = [
            Waypoint3D(
                lat=expanded_points[0].lat,
                lon=expanded_points[0].lon,
                alt_msl=start_alt,
                action=expanded_actions[0],
            )
        ]
        return AltitudeProfileResult(key_waypoints_3d=key_wps, violations=violations)

    # ── Step 4: Propagate slope constraints → eff_lo, eff_hi ──────────────────
    # Four O(n) passes.  Any alt[i] ∈ [eff_lo[i], eff_hi[i]] guarantees a
    # slope-feasible, in-band sequence can be completed in both directions.
    N = len(leg_floors)

    # Backward floor: how low must we be at leg i to still reach future floors?
    bwd_lo = list(leg_floors)
    for i in range(N - 2, -1, -1):
        bwd_lo[i] = max(leg_floors[i], bwd_lo[i + 1] - leg_max_d[i])

    # Forward floor: lowest reachable altitude coming from previous floors.
    fwd_lo = list(leg_floors)
    for i in range(1, N):
        fwd_lo[i] = max(leg_floors[i], fwd_lo[i - 1] - leg_max_d[i - 1])

    # Forward ceiling: highest reachable altitude going forward.
    fwd_hi = list(leg_ceilings)
    for i in range(1, N):
        fwd_hi[i] = min(leg_ceilings[i], fwd_hi[i - 1] + leg_max_d[i - 1])

    # Backward ceiling: how high can we be at leg i and still meet future ceilings?
    bwd_hi = list(leg_ceilings)
    for i in range(N - 2, -1, -1):
        bwd_hi[i] = min(leg_ceilings[i], bwd_hi[i + 1] + leg_max_d[i])

    eff_lo = [max(fwd_lo[i], bwd_lo[i]) for i in range(N)]
    eff_hi = [min(fwd_hi[i], bwd_hi[i]) for i in range(N)]

    for i in range(N):
        if eff_lo[i] > eff_hi[i]:
            # Slope + AGL constraints are genuinely unsatisfiable (insufficient horizontal space).
            mid_pt = _midpoint(expanded_points[i], expanded_points[i + 1])
            violations.append(
                Violation(
                    tier=ViolationTier.HARD,
                    kind="slope",
                    location=mid_pt,
                    message=(
                        f"Slope + AGL constraints unsatisfiable on leg {i}: "
                        f"eff_lo={eff_lo[i]:.1f} > eff_hi={eff_hi[i]:.1f}. "
                        f"Insufficient horizontal distance for required altitude change."
                    ),
                    measured_value=eff_lo[i],
                    limit_value=eff_hi[i],
                )
            )
            eff_hi[i] = eff_lo[i]  # safety wins

    # ── Step 5: Select cruise altitude — simple forward clamp ─────────────────
    # Maintain altitude unless forced up by floor or down by ceiling.
    # bwd_lo already baked in pre-climb requirements, so no look-ahead needed.
    leg_altitudes: list[float] = [0.0] * N
    alt = max(start_alt, eff_lo[0])
    for i in range(N):
        alt = max(alt, eff_lo[i])  # climb if terrain floor forces it
        alt = min(alt, eff_hi[i])  # descend if ceiling forces it
        leg_altitudes[i] = alt

    # ── Step 6: Clamp start altitude ──────────────────────────────────────────
    # Ensure the drone's takeoff altitude clears the first leg's floor.
    if params.takeoff_alt_msl is None:
        start_alt = max(start_alt, leg_altitudes[0])

    # ── Step 7: Insert ramp waypoints ─────────────────────────────────────────
    # After Step 4 every |leg_altitudes[i] - leg_altitudes[i-1]| ≤ leg_max_d[i-1],
    # so the ramp always fits within the preceding leg.  No backward walk needed.
    result_points: list[LatLon] = []
    result_altitudes: list[float] = []
    result_actions: list[str] = []

    result_points.append(expanded_points[0])
    result_altitudes.append(start_alt)
    result_actions.append(expanded_actions[0])

    for i in range(1, n):
        incoming_alt = result_altitudes[-1]
        # Outgoing altitude = cruise altitude for the leg leaving this waypoint.
        # For the last point (landing), repeat the final leg's altitude.
        outgoing_alt = leg_altitudes[i] if i < N else leg_altitudes[-1]
        action = expanded_actions[i]

        delta = outgoing_alt - incoming_alt
        if abs(delta) < 0.01:
            # No transition — flat continuation.
            result_points.append(expanded_points[i])
            result_altitudes.append(outgoing_alt)
            result_actions.append(action)
            continue

        ramp_dist = compute_ramp_distance_m(delta, params)
        prev_point = result_points[-1]
        this_point = expanded_points[i]
        leg_len = _leg_length_m(prev_point, this_point)

        if ramp_dist < leg_len - 0.1:
            # Normal: ramp fits within the current leg.
            ramp_start_point = _interpolate_point(
                prev_point,
                this_point,
                distance_m=leg_len - ramp_dist,
                total_m=leg_len,
            )
            result_points.append(ramp_start_point)
            result_altitudes.append(incoming_alt)
            result_actions.append("ramp_start")
        else:
            # Ramp spans the full leg (rare after Step 4; only floating-point edge cases).
            actual_slope = abs(delta) / max(leg_len, 0.1)
            if actual_slope > params.max_climb_slope * 1.02:
                violations.append(
                    Violation(
                        tier=ViolationTier.HARD,
                        kind="slope",
                        location=this_point,
                        message=(
                            f"Climb/descent slope {actual_slope:.4f} m/m exceeds limit "
                            f"{params.max_climb_slope:.4f} m/m "
                            f"(Δalt={delta:.1f} m, leg={leg_len:.1f} m)"
                        ),
                        measured_value=actual_slope,
                        limit_value=params.max_climb_slope,
                    )
                )

        result_points.append(this_point)
        result_altitudes.append(outgoing_alt)
        result_actions.append(action)

    # ── Step 8: Ramp terrain pins ─────────────────────────────────────────────
    _insert_ramp_pins(
        result_points,
        result_altitudes,
        result_actions,
        terrain_dtm,
        poi_zones,
        global_band,
        floor_spacing,
        bubble_terrain=bubble_terrain,
        point_radius_m=params.point_radius_m,
    )

    # ── Step 9: Validate AGL (both min and max) along every segment ───────────
    for i in range(1, len(result_points)):
        seg_start = result_points[i - 1]
        seg_end = result_points[i]
        alt_start = result_altitudes[i - 1]
        alt_end = result_altitudes[i]

        mid = _midpoint(seg_start, seg_end)
        active_band = band_at(mid, poi_zones, global_band)
        seg_len = _leg_length_m(seg_start, seg_end)

        if seg_len < 0.1:
            continue

        profile = terrain_dtm.sample_leg(seg_start, seg_end, floor_spacing)
        for sample in profile.samples:
            t = sample.distance_m / max(seg_len, 1e-6)
            drone_alt = alt_start + t * (alt_end - alt_start)
            agl = drone_alt - sample.elevation_msl

            if agl < active_band.min_agl_m - _config.AGL_VALIDATION_EPSILON_M:
                sample_pt = _interpolate_point(seg_start, seg_end, sample.distance_m, seg_len)
                violations.append(
                    Violation(
                        tier=ViolationTier.HARD,
                        kind="terrain_band",
                        location=sample_pt,
                        message=(
                            f"AGL {agl:.1f} m below minimum {active_band.min_agl_m:.1f} m "
                            f"(segment {i - 1}→{i}, d={sample.distance_m:.1f} m)"
                        ),
                        measured_value=agl,
                        limit_value=active_band.min_agl_m,
                    )
                )

            if agl > active_band.max_agl_m + _config.AGL_VALIDATION_EPSILON_M:
                sample_pt = _interpolate_point(seg_start, seg_end, sample.distance_m, seg_len)
                violations.append(
                    Violation(
                        tier=ViolationTier.SOFT,
                        kind="terrain_band",
                        location=sample_pt,
                        message=(
                            f"AGL {agl:.1f} m above maximum {active_band.max_agl_m:.1f} m "
                            f"(segment {i - 1}→{i}, d={sample.distance_m:.1f} m)"
                        ),
                        measured_value=agl,
                        limit_value=active_band.max_agl_m,
                    )
                )

    logger.info(
        "Altitude profile: %d key waypoints, %d violations",
        len(result_points),
        len(violations),
    )

    key_wps = [
        Waypoint3D(lat=p.lat, lon=p.lon, alt_msl=a, action=act)
        for p, a, act in zip(result_points, result_altitudes, result_actions)
    ]
    return AltitudeProfileResult(key_waypoints_3d=key_wps, violations=violations)
