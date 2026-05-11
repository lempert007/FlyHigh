"""
Generate a human-readable mission log with geometry, statistics, config, and
detailed safety violation records.
"""

from __future__ import annotations

from datetime import UTC, datetime

import numpy as np

from core.utm_utils import utm_to_latlon
from models import FlightConfig, PlanMeta, PointLatLon


def generate_mission_log(
    meta: PlanMeta,
    flight_cfg: FlightConfig,
    start: PointLatLon,
    landing: PointLatLon,
    waypoints: list[PointLatLon],
    pois,  # list[POIConfig]
    utm_points: np.ndarray,
    final_alts: np.ndarray,
    zone_str: str,
    route_hash: str = "",
    planning_logs: list[str] | None = None,
    mission_name: str | None = None,
    mission_notes: str | None = None,
) -> str:
    """Build a plain-text mission log string for inclusion in the ZIP.

    Args:
        meta: PlanMeta computed during planning
        flight_cfg: FlightConfig used for this mission
        start: takeoff point
        landing: landing point
        waypoints: intermediate transit waypoints
        pois: POI + maneuver configs
        utm_points: (N, 2) dense UTM route points
        final_alts: (N,) final MSL altitudes
        zone_str: UTM zone string for coordinate conversion

    Returns:
        Multi-line plain-text string.
    """
    SEP = "=" * 62
    lines: list[str] = []

    now = datetime.now(tz=UTC).strftime("%Y-%m-%d %H:%M UTC")
    lines += [SEP, "  FlyHigh — Mission Log", f"  Generated: {now}"]
    if mission_name:
        lines.append(f"  Mission    : {mission_name}")
    if mission_notes:
        lines.append(f"  Notes      : {mission_notes}")
    if route_hash:
        lines.append(f"  Route hash : {route_hash}")
    lines.append(SEP)

    # ── Geometry ──────────────────────────────────────────────────────────────
    lines += ["", "[ MISSION GEOMETRY ]"]
    lines.append(f"  Start   : {start.lat:.6f}, {start.lon:.6f}")
    for i, wp in enumerate(waypoints):
        lines.append(f"  WP {i + 1:<3} : {wp.lat:.6f}, {wp.lon:.6f}")
    for i, poi in enumerate(pois):
        m = poi.maneuver
        if m.polygon:
            detail = (
                f"{m.type} polygon ({len(m.polygon)} vertices) spacing={m.sweep_spacing_m:.0f} m"
            )
        else:
            detail = (
                f"{m.type} {m.width_m:.0f}×{m.height_m:.0f} m spacing={m.sweep_spacing_m:.0f} m"
            )
        name_str = f" ({poi.name})" if getattr(poi, "name", None) else ""
        lines.append(
            f"  POI {i + 1:<3}{name_str}: {poi.point.lat:.6f}, {poi.point.lon:.6f}  [{detail}]"
        )
    lines.append(f"  Landing : {landing.lat:.6f}, {landing.lon:.6f}")

    # ── Statistics ────────────────────────────────────────────────────────────
    lines += ["", "[ FLIGHT STATISTICS ]"]
    dist_km = meta.total_distance_m / 1000.0
    mins = int(meta.flight_time_s // 60)
    secs = int(meta.flight_time_s % 60)
    lines.append(f"  Total distance : {dist_km:.2f} km ({meta.total_distance_m:.0f} m)")
    lines.append(f"  Flight time    : {mins} min {secs} s")

    if final_alts is not None and len(final_alts) > 0:
        lines.append(f"  Altitude range : {final_alts.min():.1f} – {final_alts.max():.1f} m MSL")

    # ── Config ────────────────────────────────────────────────────────────────
    lines += ["", "[ FLIGHT CONFIG ]"]
    lines.append(f"  AGL range      : {flight_cfg.min_agl_m} – {flight_cfg.max_agl_m} m")
    lines.append(f"  Safety bubble  : {flight_cfg.point_radius_m} m radius (hard)")
    cam_status = (
        f"{flight_cfg.max_surface_radius_m} m radius (hard)"
        if flight_cfg.max_surface_radius_m > 0
        else "disabled"
    )
    lines.append(f"  Camera range   : {cam_status}")
    lines.append(f"  Cruise speed   : {flight_cfg.cruise_speed_ms} m/s")
    lines.append(f"  Climb rate     : {flight_cfg.climb_rate_ms} m/s")
    lines.append(f"  Route spacing  : {flight_cfg.spacing_m} m")
    lines.append(f"  Smart Route    : {'enabled' if flight_cfg.smart_route else 'disabled'}")

    # ── Status ────────────────────────────────────────────────────────────────
    lines += ["", "[ STATUS ]"]
    if meta.error:
        lines.append(f"  ❌ ERROR  : {meta.error}")
    if meta.warning:
        lines.append(f"  ⚠  WARNING: {meta.warning}")
    if not meta.error and not meta.warning:
        lines.append("  ✓ No warnings or errors.")

    # ── Violations ────────────────────────────────────────────────────────────
    lines += ["", f"[ SAFETY VIOLATIONS — {len(meta.violations)} total ]"]
    if not meta.violations:
        lines.append("  None detected.")
    else:
        for v in meta.violations:
            idx = v.point_index
            try:
                lat, lon = utm_to_latlon(
                    float(utm_points[idx, 0]),
                    float(utm_points[idx, 1]),
                    zone_str,
                )
                coord_str = f"lat={lat:.6f} lon={lon:.6f}"
            except Exception:
                coord_str = f"utm_idx={idx}"
            alt = float(final_alts[idx]) if final_alts is not None else float("nan")
            lines.append(
                f"  [{v.kind.upper():10s}] pt {idx:5d}  {coord_str}  "
                f"alt={alt:.1f} m  —  {v.description}"
            )

    # ── Planning log ──────────────────────────────────────────────────────────
    if planning_logs:
        lines += ["", "[ PLANNING LOG ]"]
        for entry in planning_logs:
            lines.append(f"  {entry}")

    lines += ["", SEP, ""]
    return "\n".join(lines)
