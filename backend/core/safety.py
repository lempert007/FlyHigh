"""
Safety validation: vertical clearance and horizontal safety-bubble checks.

Returns structured Violation objects. Mapping to ViolationInfo (API model)
is the adapter layer's responsibility (plan.py).
"""

from __future__ import annotations

import logging

import numpy as np

import config
from core.terrain import TerrainIndex
from core.types import FlightParams, LatLon, Violation, ViolationTier, Waypoint3D

logger = logging.getLogger(__name__)


def check_route_safety(
    waypoints: list[Waypoint3D],
    utm_points: np.ndarray,
    vertical_terrain: TerrainIndex,
    bubble_terrain: TerrainIndex,
    camera_terrain: TerrainIndex,
    params: FlightParams,
) -> list[Violation]:
    """Run all safety checks on the final dense 3-D route.

    Checks (in order):
        1. HARD: vertical clearance — drone alt ≥ vertical_terrain surface at every point.
        2. HARD: horizontal bubble at point_radius_m, sampled from bubble_terrain.
        3. HARD: camera range — drone must not exceed max_agl_m above lowest surface within
           max_surface_radius_m, sampled from camera_terrain.

    vertical_terrain is always the DSM (or the sole available terrain when only one is loaded).
    bubble_terrain and camera_terrain are routed per FlightConfig.safety_radius_terrain /
    camera_range_terrain.

    Never raises. Always returns the full list.
    """
    if not waypoints:
        return []

    violations: list[Violation] = []

    # Build numpy arrays for vectorised ops
    lats = np.array([w.lat for w in waypoints])
    lons = np.array([w.lon for w in waypoints])
    alts = np.array([w.alt_msl for w in waypoints])

    # ── 1. Vertical clearance ─────────────────────────────────────────────────
    vert_elevs = vertical_terrain.sample_points(utm_points)
    vertical_violation = np.where(np.isnan(vert_elevs), False, alts < vert_elevs - config.AGL_VALIDATION_EPSILON_M)

    for i in np.where(vertical_violation)[0]:
        gap = float(alts[i] - vert_elevs[i])
        violations.append(Violation(
            tier=ViolationTier.HARD,
            kind="vertical",
            location=LatLon(lat=float(lats[i]), lon=float(lons[i])),
            message=(
                f"Drone at {alts[i]:.1f} m MSL is {abs(gap):.1f} m below "
                f"surface ({vert_elevs[i]:.1f} m) at point {int(i)}."
            ),
            measured_value=float(alts[i]),
            limit_value=float(vert_elevs[i]),
        ))

    # ── 2. Horizontal safety bubble (vectorised) ──────────────────────────────
    n_pts = len(waypoints)
    n_samples = config.BUBBLE_SAMPLE_COUNT
    radius = params.point_radius_m
    angles = np.linspace(0.0, 2 * np.pi, n_samples, endpoint=False)

    ring_e = utm_points[:, 0:1] + radius * np.cos(angles)  # (n_pts, n_samples)
    ring_n = utm_points[:, 1:2] + radius * np.sin(angles)
    ring_pts_flat = np.column_stack([ring_e.ravel(), ring_n.ravel()])

    bubble_ring_flat = bubble_terrain.sample_points(ring_pts_flat)
    bubble_ring = bubble_ring_flat.reshape(n_pts, n_samples)

    max_obstacle = np.nanmax(bubble_ring, axis=1)
    bubble_safe = (alts + config.AGL_VALIDATION_EPSILON_M >= max_obstacle) | np.all(np.isnan(bubble_ring), axis=1)

    for i in np.where(~bubble_safe)[0]:
        violations.append(Violation(
            tier=ViolationTier.HARD,
            kind="horizontal",
            location=LatLon(lat=float(lats[i]), lon=float(lons[i])),
            message=(
                f"An obstacle within {radius:.1f} m of point {int(i)} "
                f"(alt {alts[i]:.1f} m MSL) is above drone altitude."
            ),
            measured_value=float(alts[i]),
            limit_value=float(max_obstacle[i]),
        ))

    # ── 3. Camera range — HARD check (max_surface_radius_m) ──────────────────
    cam_radius = params.max_surface_radius_m
    if cam_radius > 0:
        cam_ring_e = utm_points[:, 0:1] + cam_radius * np.cos(angles)
        cam_ring_n = utm_points[:, 1:2] + cam_radius * np.sin(angles)
        cam_pts_flat = np.column_stack([cam_ring_e.ravel(), cam_ring_n.ravel()])
        cam_ring_flat = camera_terrain.sample_points(cam_pts_flat)
        cam_ring = cam_ring_flat.reshape(n_pts, n_samples)
        min_cam_surface = np.nanmin(cam_ring, axis=1)
        cam_ok = (alts - min_cam_surface <= params.max_agl_m + config.CAMERA_RANGE_EPSILON_M) | np.all(np.isnan(cam_ring), axis=1)
        for i in np.where(~cam_ok)[0]:
            violations.append(Violation(
                tier=ViolationTier.SOFT,
                kind="camera_range",
                location=LatLon(lat=float(lats[i]), lon=float(lons[i])),
                message=(
                    f"Drone is {alts[i] - min_cam_surface[i]:.0f} m above lowest surface "
                    f"within {cam_radius:.0f} m (max {params.max_agl_m:.0f} m) — "
                    f"outside camera range."
                ),
                measured_value=float(alts[i] - min_cam_surface[i]),
                limit_value=params.max_agl_m,
            ))

    logger.info("Safety check: %d violation(s)", len(violations))
    return violations

