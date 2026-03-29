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


def _sample_disc(
    utm_points: np.ndarray,
    radius: float,
    terrain: TerrainIndex,
) -> np.ndarray:
    """Sample terrain elevations over a disc of given radius at each route point.

    Returns an array of shape (n_pts, 1 + BUBBLE_RING_COUNT * BUBBLE_SAMPLE_COUNT)
    where each row contains the terrain elevations at the disc center and ring samples.
    """
    n_pts = len(utm_points)
    n_az = config.BUBBLE_SAMPLE_COUNT
    n_rings = config.BUBBLE_RING_COUNT
    angles = np.linspace(0.0, 2 * np.pi, n_az, endpoint=False)
    ring_radii = np.linspace(radius / n_rings, radius, n_rings)

    ring_e = (
        utm_points[:, 0:1, np.newaxis] + ring_radii[np.newaxis, :, np.newaxis] * np.cos(angles)
    ).reshape(n_pts, n_rings * n_az)
    ring_n = (
        utm_points[:, 1:2, np.newaxis] + ring_radii[np.newaxis, :, np.newaxis] * np.sin(angles)
    ).reshape(n_pts, n_rings * n_az)

    disc_e = np.concatenate([utm_points[:, 0:1], ring_e], axis=1)
    disc_n = np.concatenate([utm_points[:, 1:2], ring_n], axis=1)
    disc_flat = np.column_stack([disc_e.ravel(), disc_n.ravel()])
    return terrain.sample_points(disc_flat).reshape(n_pts, 1 + n_rings * n_az)


def compute_profile_bands(
    utm_points: np.ndarray,
    terrain_elevs_fallback: np.ndarray,
    bubble_terrain: TerrainIndex,
    camera_terrain: TerrainIndex,
    params: FlightParams,
) -> tuple[np.ndarray, np.ndarray]:
    """Compute per-point terrain reference arrays for the altitude profile chart.

    Returns:
        bubble_peak: peak terrain elevation within the safety bubble disc at each point.
        camera_min:  minimum terrain elevation within the camera range disc at each point.

    NaN disc samples fall back to terrain_elevs_fallback so the chart always has values.
    """
    disc_elev = _sample_disc(utm_points, params.point_radius_m, bubble_terrain)
    raw_peak = np.nanmax(disc_elev, axis=1)
    bubble_peak = np.where(np.isnan(raw_peak), terrain_elevs_fallback, raw_peak)

    if params.max_surface_radius_m > 0:
        cam_elev = _sample_disc(utm_points, params.max_surface_radius_m, camera_terrain)
        raw_min = np.nanmin(cam_elev, axis=1)
        camera_min = np.where(np.isnan(raw_min), terrain_elevs_fallback, raw_min)
    else:
        camera_min = terrain_elevs_fallback.copy()

    return bubble_peak, camera_min


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
        2. HARD: horizontal bubble — disc of point_radius_m sampled from bubble_terrain;
           drone must be at least min_agl_m above the peak terrain in that disc.
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
    logger.info("Checking vertical surface clearance: %d waypoints", len(waypoints))
    vert_elevs = vertical_terrain.sample_points(utm_points)
    vertical_violation = np.where(
        np.isnan(vert_elevs), False, alts < vert_elevs - config.AGL_VALIDATION_EPSILON_M
    )

    for i in np.where(vertical_violation)[0]:
        gap = float(alts[i] - vert_elevs[i])
        violations.append(
            Violation(
                tier=ViolationTier.HARD,
                kind="vertical",
                location=LatLon(lat=float(lats[i]), lon=float(lons[i])),
                message=(
                    f"Drone at {alts[i]:.1f} m MSL is {abs(gap):.1f} m below "
                    f"surface ({vert_elevs[i]:.1f} m) at point {int(i)}."
                ),
                measured_value=float(alts[i]),
                limit_value=float(vert_elevs[i]),
            )
        )

    # ── 2. Horizontal safety bubble — disc sample (vectorised) ───────────────
    # Sample the full disc (center + K concentric rings) and require that the
    # drone is at least min_agl_m above the highest terrain in that disc.
    logger.info("Verifying safety bubble disc compliance: %d waypoints", len(waypoints))
    n_pts = len(waypoints)
    n_az = config.BUBBLE_SAMPLE_COUNT
    radius = params.point_radius_m
    angles = np.linspace(0.0, 2 * np.pi, n_az, endpoint=False)

    disc_elev = _sample_disc(utm_points, radius, bubble_terrain)

    peak_terrain = np.nanmax(disc_elev, axis=1)
    all_nan = np.all(np.isnan(disc_elev), axis=1)
    bubble_safe = (
        alts >= peak_terrain + params.min_agl_m - config.AGL_VALIDATION_EPSILON_M
    ) | all_nan

    for i in np.where(~bubble_safe)[0]:
        clearance = float(alts[i] - peak_terrain[i])
        violations.append(
            Violation(
                tier=ViolationTier.HARD,
                kind="horizontal",
                location=LatLon(lat=float(lats[i]), lon=float(lons[i])),
                message=(
                    f"Only {clearance:.1f} m clearance above highest terrain within "
                    f"{radius:.0f} m of point {int(i)} — minimum {params.min_agl_m:.0f} m required."
                ),
                measured_value=clearance,
                limit_value=params.min_agl_m,
            )
        )

    # ── 3. Camera range — HARD check (max_surface_radius_m) ──────────────────
    logger.info("Checking camera AGL band compliance")
    cam_radius = params.max_surface_radius_m
    if cam_radius > 0:
        cam_ring_e = utm_points[:, 0:1] + cam_radius * np.cos(angles)
        cam_ring_n = utm_points[:, 1:2] + cam_radius * np.sin(angles)
        cam_pts_flat = np.column_stack([cam_ring_e.ravel(), cam_ring_n.ravel()])
        cam_ring_flat = camera_terrain.sample_points(cam_pts_flat)
        cam_ring = cam_ring_flat.reshape(n_pts, n_az)
        min_cam_surface = np.nanmin(cam_ring, axis=1)
        cam_ok = (
            alts - min_cam_surface <= params.max_agl_m + config.CAMERA_RANGE_EPSILON_M
        ) | np.all(np.isnan(cam_ring), axis=1)
        for i in np.where(~cam_ok)[0]:
            violations.append(
                Violation(
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
                )
            )

    logger.info("Safety check: %d violation(s)", len(violations))
    return violations
