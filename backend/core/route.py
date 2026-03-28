"""
Route planning pipeline orchestrator.

plan_route() is the single entry point. Each step is a named function call —
no business logic lives here.
"""

from __future__ import annotations

import logging
import math
from typing import TYPE_CHECKING

import numpy as np
import utm

if TYPE_CHECKING:
    from core.terrain import TerrainIndex

from config import SMART_ROUTE_LATERAL_SAMPLES
from core.altitude import plan_altitude_profile
from core.battery import estimate_energy_wh, estimate_flight_time_s
from core.safety import check_route_safety
from core.terrain import sample_elevation as _sample_elevation
from core.types import (
    AltitudeBand,
    LatLon,
    MissionInput,
    MissionResult,
    Waypoint3D,
)
from core.utm_utils import latlon_to_utm, utm_to_latlon
from models import PointLatLon

logger = logging.getLogger(__name__)


# ── Coordinate utilities (kept public for plan.py) ────────────────────────────


def detect_mission_zone(points: list[PointLatLon]) -> str:
    """Determine the single UTM zone for a list of lat/lon points."""
    if not points:
        raise ValueError("No points provided for zone detection")
    _, _, zone_str = latlon_to_utm(points[0].lat, points[0].lon)
    for pt in points[1:]:
        latlon_to_utm(pt.lat, pt.lon, expected_zone=zone_str)
    return zone_str


# ── Heading and distance utilities ────────────────────────────────────────────


def compute_headings(utm_points: np.ndarray) -> np.ndarray:
    """Compute forward bearing (degrees, 0=North) at each point."""
    n = len(utm_points)
    if n < 2:
        return np.zeros(n)
    delta_e = np.diff(utm_points[:, 0])
    delta_n = np.diff(utm_points[:, 1])
    bearings = np.degrees(np.arctan2(delta_e, delta_n)) % 360.0
    return np.append(bearings, bearings[-1])


def compute_cumulative_distances(utm_points: np.ndarray) -> np.ndarray:
    """Return cumulative 2-D arc lengths starting at 0."""
    if len(utm_points) < 2:
        return np.zeros(len(utm_points))
    diffs = np.diff(utm_points, axis=0)
    seg_lens = np.hypot(diffs[:, 0], diffs[:, 1])
    return np.concatenate([[0.0], np.cumsum(seg_lens)])


def total_path_length(utm_points: np.ndarray) -> float:
    """3-D Euclidean path length. Requires (N,2) or (N,3) input."""
    if len(utm_points) < 2:
        return 0.0
    diffs = np.diff(utm_points, axis=0)
    return float(np.sum(np.linalg.norm(diffs, axis=1)))


# ── Densification ─────────────────────────────────────────────────────────────


def densify_waypoints_3d(
    key_waypoints: list[Waypoint3D],
    spacing_m: float,
) -> list[Waypoint3D]:
    """Interpolate between key waypoints at spacing_m.

    Altitude is linearly interpolated — preserves exact flat-leg altitudes and
    exact ramp slopes. The action label is inherited from the nearest key waypoint.
    """
    if len(key_waypoints) < 2:
        return list(key_waypoints)

    # Build UTM array and altitude array from key waypoints
    utm_arr = np.array(
        [utm.from_latlon(w.lat, w.lon)[:2] for w in key_waypoints],
        dtype=float,
    )
    alts_arr = np.array([w.alt_msl for w in key_waypoints], dtype=float)

    # Compute cumulative distances along key waypoints
    diffs = np.diff(utm_arr, axis=0)
    seg_lens = np.hypot(diffs[:, 0], diffs[:, 1])
    cum_dist = np.concatenate([[0.0], np.cumsum(seg_lens)])
    total_len = cum_dist[-1]

    if total_len < 1e-6:
        return list(key_waypoints)

    # Build dense sample distances
    n_pts = max(2, math.ceil(total_len / spacing_m) + 1)
    sample_dists = np.linspace(0.0, total_len, n_pts)

    dense_e = np.interp(sample_dists, cum_dist, utm_arr[:, 0])
    dense_n = np.interp(sample_dists, cum_dist, utm_arr[:, 1])
    dense_alt = np.interp(sample_dists, cum_dist, alts_arr)

    # Assign action from the nearest key waypoint using binary search
    actions = [w.action for w in key_waypoints]
    indices = np.searchsorted(cum_dist, sample_dists, side="right").clip(0, len(cum_dist) - 1)
    _, _, zone_number, zone_letter = utm.from_latlon(key_waypoints[0].lat, key_waypoints[0].lon)
    zone_str = f"{zone_number}{zone_letter}"

    result: list[Waypoint3D] = []
    for i in range(n_pts):
        lat, lon = utm_to_latlon(float(dense_e[i]), float(dense_n[i]), zone_str)
        result.append(
            Waypoint3D(
                lat=lat,
                lon=lon,
                alt_msl=float(dense_alt[i]),
                action=actions[int(indices[i])],
            )
        )

    return result


# ── Smart Route (lateral path shift) ─────────────────────────────────────────


def _smart_route_lateral(
    key_waypoints: list[Waypoint3D],
    dtm: TerrainIndex,
    corridor_m: float,
) -> tuple[list[Waypoint3D], str]:
    """Shift transit legs laterally to seek flatter terrain.

    Operates on the key waypoint list (sparse) before densification.
    Shifts only consecutive transit (non-POI) segments.
    Uses a sin-bell taper so endpoints never move.

    Scoring: minimise terrain elevation range (max−min) along the shifted
    path, which directly reduces the altitude changes the drone must make.
    """
    poi_actions = {"lawnmower", "warp_weft", "poi"}
    pts = list(key_waypoints)
    n = len(pts)
    blocks_analysed = 0
    shift_offsets: list[float] = []

    # Pre-build the perpendicular unit vector and taper once per block
    offsets = np.linspace(-corridor_m, corridor_m, SMART_ROUTE_LATERAL_SAMPLES)

    i = 0
    while i < n:
        if pts[i].action in poi_actions:
            i += 1
            continue

        # Find the end of this transit block
        j = i
        while j < n and pts[j].action not in poi_actions:
            j += 1

        blocks_analysed += 1
        block_len = j - i
        if block_len > 4:
            block_utm = np.array([utm.from_latlon(w.lat, w.lon)[:2] for w in pts[i:j]], dtype=float)
            axis = block_utm[-1] - block_utm[0]
            axis_len = float(np.linalg.norm(axis))
            if axis_len > 1e-6:
                perp = np.array([-axis[1], axis[0]]) / axis_len
                taper = np.outer(np.sin(np.linspace(0.0, np.pi, block_len)), perp)

                best_offset, best_score = 0.0, np.inf
                for offset in offsets:
                    shifted = block_utm + taper * offset
                    elevs = _sample_elevation(dtm._interp, shifted)
                    valid = elevs[~np.isnan(elevs)]
                    if len(valid) < 2:
                        continue
                    # Range (max−min) measures how much altitude change the drone
                    # will need — minimising this finds the flattest corridor.
                    score = float(np.ptp(valid))
                    if score < best_score:
                        best_score, best_offset = score, offset

                if abs(best_offset) > 1e-3:
                    shifted_block = block_utm + taper * best_offset
                    _, __, z_num, z_let = utm.from_latlon(pts[i].lat, pts[i].lon)
                    zone_str3 = f"{z_num}{z_let}"
                    for k, (e, n_) in enumerate(shifted_block):
                        lat, lon = utm_to_latlon(float(e), float(n_), zone_str3)
                        old = pts[i + k]
                        pts[i + k] = Waypoint3D(
                            lat=lat, lon=lon, alt_msl=old.alt_msl, action=old.action
                        )
                    shift_offsets.append(abs(best_offset))

        i = j

    if not shift_offsets:
        summary = f"Analysed {blocks_analysed} transit blocks — no lateral improvement found."
    else:
        avg = sum(shift_offsets) / len(shift_offsets)
        summary = (
            f"Shifted {len(shift_offsets)}/{blocks_analysed} transit blocks — "
            f"avg offset {avg:.1f} m (max {max(shift_offsets):.1f} m)."
        )
    logger.info("Smart Route: %s", summary)
    return pts, summary


# ── Plan route (main entry point) ─────────────────────────────────────────────


def plan_route(mission: MissionInput) -> MissionResult:
    """Execute the full mission planning pipeline.

    Steps:
        1. Resolve POI visit order.
        2. Build global AltitudeBand.
        3. Build PoiZone objects and 2-D waypoint sequences.
        4. Assemble full 2-D waypoint list.
        5. Compute 3-D altitude profile (sparse key waypoints).
        6. Optional Smart Route lateral shift.
        7. Densify key waypoints to spacing_m grid.
        8. Compute headings.
        9. Run safety validation.
       10. Estimate energy and flight time.
       11. Return MissionResult.
    """
    params = mission.params
    dtm = mission.dtm
    dsm = mission.dsm

    global_band = AltitudeBand(min_agl_m=params.min_agl_m, max_agl_m=params.max_agl_m)

    # POI order was already resolved by the caller (api/plan.py) before building
    # the MissionInput — use zones and patterns as-is.
    ordered_zones = mission.poi_zones
    ordered_2d = mission.poi_2d_waypoints

    # ── Steps 2–4: Assemble the full 2-D waypoint + action list ───────────────
    waypoints_2d: list[LatLon] = [mission.start]
    actions: list[str] = ["waypoint"]

    for wp in mission.waypoints:
        waypoints_2d.append(wp)
        actions.append("waypoint")

    for zone, pattern in zip(ordered_zones, ordered_2d):
        # Use the first pattern point as POI entry; rest as maneuver waypoints
        if pattern:
            waypoints_2d.append(pattern[0])
            actions.append("poi")
            for pt in pattern[1:]:
                waypoints_2d.append(pt)
                # Determine action from zone type
                if "warp" in zone.zone_id.lower() or "weft" in zone.zone_id.lower():
                    actions.append("warp_weft")
                else:
                    actions.append("lawnmower")
        else:
            # No pattern generated — use zone centroid
            if not zone.boundary_latlon:
                logger.warning("POI zone %s has no boundary points — skipping", zone.zone_id)
                continue
            centroid_lat = sum(v.lat for v in zone.boundary_latlon) / len(zone.boundary_latlon)
            centroid_lon = sum(v.lon for v in zone.boundary_latlon) / len(zone.boundary_latlon)
            waypoints_2d.append(LatLon(lat=centroid_lat, lon=centroid_lon))
            actions.append("poi")

    waypoints_2d.append(mission.landing)
    actions.append("land")

    logger.info(
        "2-D path: %d waypoints (%d POI zones), start=%s, landing=%s",
        len(waypoints_2d),
        len(ordered_zones),
        f"({mission.start.lat:.4f},{mission.start.lon:.4f})",
        f"({mission.landing.lat:.4f},{mission.landing.lon:.4f})",
    )

    # ── Step 5: 3-D altitude profile ──────────────────────────────────────────
    altitude_result = plan_altitude_profile(
        waypoints_2d=waypoints_2d,
        waypoint_actions=actions,
        terrain_dtm=dtm,
        poi_zones=ordered_zones,
        global_band=global_band,
        params=params,
    )
    key_wps = altitude_result.key_waypoints_3d
    altitude_violations = altitude_result.violations

    logger.info("Key waypoints after altitude planning: %d", len(key_wps))

    # ── Step 6: Smart Route (optional) ────────────────────────────────────────
    smart_route_summary: str | None = None
    pre_smart_route_utm = None
    if params.smart_route_corridor_m is not None and len(key_wps) > 4:
        # Densify original key waypoints so we can produce a before/after diff
        pre_dense = densify_waypoints_3d(key_wps, params.spacing_m)
        pre_smart_route_utm = np.array([list(utm.from_latlon(w.lat, w.lon)[:2]) for w in pre_dense])
        key_wps, smart_route_summary = _smart_route_lateral(
            key_wps,
            dtm,
            params.smart_route_corridor_m,
        )

    # ── Step 7: Densify ───────────────────────────────────────────────────────
    dense_wps = densify_waypoints_3d(key_wps, params.spacing_m)
    logger.info("Dense waypoints: %d at %.1f m spacing", len(dense_wps), params.spacing_m)

    # ── Step 8: Safety checks ─────────────────────────────────────────────────
    dense_utm = np.array([list(utm.from_latlon(w.lat, w.lon)[:2]) for w in dense_wps])
    bubble_terrain = mission.bubble_terrain if mission.bubble_terrain is not None else dsm
    camera_terrain = mission.camera_terrain if mission.camera_terrain is not None else dsm
    safety_violations = check_route_safety(
        dense_wps,
        dense_utm,
        vertical_terrain=dsm,
        bubble_terrain=bubble_terrain,
        camera_terrain=camera_terrain,
        params=params,
    )
    all_violations = altitude_violations + safety_violations

    # ── Step 10: Energy and flight time ───────────────────────────────────────
    dense_alts = np.array([w.alt_msl for w in dense_wps])
    energy_wh = estimate_energy_wh(dense_utm, dense_alts, params)
    flight_time_s = estimate_flight_time_s(dense_utm, dense_alts, params)
    total_dist_m = float(compute_cumulative_distances(dense_utm)[-1]) if len(dense_utm) > 1 else 0.0
    budget_pct = (100.0 * energy_wh / params.battery_wh) if params.battery_wh > 0 else float("inf")

    logger.info(
        "Route complete: %.0f m, %.0f s, %.1f Wh (%.0f%% battery)",
        total_dist_m,
        flight_time_s,
        energy_wh,
        budget_pct,
    )

    return MissionResult(
        waypoints_3d=dense_wps,
        dense_utm=dense_utm,
        violations=all_violations,
        total_distance_m=round(total_dist_m, 1),
        flight_time_s=round(flight_time_s, 1),
        energy_wh=round(energy_wh, 2),
        budget_pct=round(budget_pct, 1),
        terrain_resolution_m=getattr(dsm, "resolution_m", None),
        covered_area_m2=None,  # computed in plan.py from maneuver parameters
        smart_route_summary=smart_route_summary,
        pre_smart_route_utm=pre_smart_route_utm,
    )
