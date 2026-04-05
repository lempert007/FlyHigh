"""
2-D maneuver pattern geometry.

All functions return lists of LatLon waypoints. Zero altitude decisions are made
here — altitude assignment is delegated entirely to altitude.py.
"""

from __future__ import annotations

import logging
import math

import numpy as np

import config as _config
from core.geometry import points_in_polygon_utm
from core.types import AltitudeBand, LatLon, PoiZone
from core.utm_utils import latlon_to_utm, utm_to_latlon_obj
from models import ManeuverType, POIConfig

logger = logging.getLogger(__name__)

MIN_SWEEP_SPACING_M: float = 1.0
"""Minimum allowed sweep spacing. Values below this collapse strips into a single point."""


# ── Camera geometry ───────────────────────────────────────────────────────────


def compute_precise_spacing(h: float, fov_deg: float) -> float:
    """Ground footprint width (m) for a nadir camera at height h above ground.

    Args:
        h: altitude above ground in metres (must be > 0).
        fov_deg: horizontal field of view in degrees (must be in (0, 180)).

    Returns:
        Precise spacing (footprint width) in metres: 2 * h * tan(fov/2).
    """
    if h <= 0 or not (0 < fov_deg < 180):
        raise ValueError(f"Invalid inputs to compute_precise_spacing: h={h}, fov_deg={fov_deg}")
    return 2.0 * h * math.tan(math.radians(fov_deg / 2.0))


def compute_overlap_spacing(precise_spacing: float, overlap: float) -> float:
    """Strip centre-line spacing (m) after applying overlap to the precise spacing.

    Args:
        precise_spacing: ground footprint width in metres.
        overlap: fraction of footprint covered by the adjacent strip [0, 1).

    Returns:
        Centre-to-centre overlap spacing: precise_spacing * (1 - overlap).
    """
    if not (0.0 <= overlap < 1.0):
        raise ValueError(f"Overlap must be in [0, 1), got {overlap}")
    return precise_spacing * (1.0 - overlap)


# ── Rectangle lawnmower ───────────────────────────────────────────────────────


def generate_lawnmower_pattern(
    center: LatLon,
    width_m: float,
    height_m: float,
    sweep_spacing_m: float,
    entry_bearing_deg: float = 0.0,
) -> list[LatLon]:
    """Return boustrophedon sweep waypoints for a rectangle centred on center.

    Strips run along the bearing direction, spaced sweep_spacing_m apart across
    width_m.
    """
    e0, n0, zone_str = latlon_to_utm(center.lat, center.lon)

    if sweep_spacing_m < MIN_SWEEP_SPACING_M:
        logger.warning(
            "Sweep spacing %.1f m is below minimum %.1f m — clamped.",
            sweep_spacing_m,
            MIN_SWEEP_SPACING_M,
        )
    strip_width = max(sweep_spacing_m, MIN_SWEEP_SPACING_M)
    n_strips = max(1, math.ceil(width_m / strip_width))
    half_w = width_m / 2.0
    half_h = height_m / 2.0

    bearing_rad = math.radians(entry_bearing_deg)
    cos_b = math.cos(bearing_rad)
    sin_b = math.sin(bearing_rad)

    def rotate(e_local: float, n_local: float) -> tuple[float, float]:
        return (
            e0 + e_local * cos_b - n_local * sin_b,
            n0 + e_local * sin_b + n_local * cos_b,
        )

    waypoints: list[LatLon] = []
    for i in range(n_strips):
        cross = -half_w + strip_width * (i + 0.5)
        if i % 2 == 0:
            p_start = rotate(cross, -half_h)
            p_end = rotate(cross, +half_h)
        else:
            p_start = rotate(cross, +half_h)
            p_end = rotate(cross, -half_h)
        waypoints.append(utm_to_latlon_obj(p_start[0], p_start[1], zone_str))
        waypoints.append(utm_to_latlon_obj(p_end[0], p_end[1], zone_str))

    return waypoints


def generate_warp_and_weft_pattern(
    center: LatLon,
    width_m: float,
    height_m: float,
    sweep_spacing_m: float,
) -> list[LatLon]:
    """Return cross-hatch waypoints: lawnmower at 0° then 90°."""
    warp = generate_lawnmower_pattern(center, width_m, height_m, sweep_spacing_m, 0.0)
    weft = generate_lawnmower_pattern(center, height_m, width_m, sweep_spacing_m, 90.0)
    return warp + weft


# ── Smart lawnmower ──────────────────────────────────────────────────────────


def generate_smart_lawnmower_pattern(
    center: LatLon,
    width_m: float,
    height_m: float,
    h: float,
    fov_deg: float,
    overlap: float,
    entry_bearing_deg: float = 0.0,
) -> list[LatLon]:
    """Rectangle lawnmower with strip spacing derived from camera FOV and overlap.

    Computes spacing via :func:`compute_precise_spacing` and
    :func:`compute_overlap_spacing`, then delegates entirely to
    :func:`generate_lawnmower_pattern`.

    Args:
        center: POI centre point.
        width_m: coverage width (cross-track) in metres.
        height_m: coverage height (along-track) in metres.
        h: AGL altitude in metres (resolves at dispatch: poi_max_agl override or global max_agl).
        fov_deg: camera horizontal FOV in degrees.
        overlap: strip overlap fraction [0, SMART_LAWNMOWER_MAX_OVERLAP).
        entry_bearing_deg: bearing rotation forwarded to the lawnmower generator.

    Returns:
        Same list[LatLon] as :func:`generate_lawnmower_pattern`.
    """
    precise_spacing = compute_precise_spacing(h, fov_deg)
    overlap_spacing = compute_overlap_spacing(precise_spacing, overlap)

    if overlap_spacing < _config.SMART_LAWNMOWER_MIN_SPACING_M:
        logger.warning(
            "Smart lawnmower: computed overlap spacing %.2f m is below minimum %.1f m — clamped. "
            "(h=%.1f m, fov=%.1f°, overlap=%.2f)",
            overlap_spacing,
            _config.SMART_LAWNMOWER_MIN_SPACING_M,
            h,
            fov_deg,
            overlap,
        )
        overlap_spacing = _config.SMART_LAWNMOWER_MIN_SPACING_M

    return generate_lawnmower_pattern(center, width_m, height_m, overlap_spacing, entry_bearing_deg)


def generate_smart_lawnmower_polygon_pattern(
    polygon_latlon: list,
    h: float,
    fov_deg: float,
    overlap: float,
    zone_str: str,
    *,
    prefer_start: LatLon | None = None,
) -> list[LatLon]:
    """Polygon lawnmower with strip spacing derived from camera FOV and overlap.

    Mirrors :func:`generate_smart_lawnmower_pattern` but for arbitrary polygons.
    Delegates to :func:`generate_lawnmower_polygon_pattern`.
    """
    precise_spacing = compute_precise_spacing(h, fov_deg)
    overlap_spacing = compute_overlap_spacing(precise_spacing, overlap)

    if overlap_spacing < _config.SMART_LAWNMOWER_MIN_SPACING_M:
        logger.warning(
            "Smart lawnmower (polygon): computed overlap spacing %.2f m is below minimum %.1f m — clamped.",
            overlap_spacing,
            _config.SMART_LAWNMOWER_MIN_SPACING_M,
        )
        overlap_spacing = _config.SMART_LAWNMOWER_MIN_SPACING_M

    return generate_lawnmower_polygon_pattern(
        polygon_latlon, overlap_spacing, zone_str, prefer_start=prefer_start
    )


# ── Polygon lawnmower ─────────────────────────────────────────────────────────


def generate_lawnmower_polygon_pattern(
    polygon_latlon: list,  # LatLon or PointLatLon (any object with .lat / .lon)
    sweep_spacing_m: float,
    zone_str: str,
    *,
    transpose: bool = False,
    prefer_start: LatLon | None = None,
) -> list[LatLon]:
    """Boustrophedon sweep clipped to an arbitrary polygon. Pure 2-D geometry.

    Args:
        polygon_latlon: polygon vertices (PointLatLon or LatLon).
        sweep_spacing_m: strip spacing in metres.
        zone_str: UTM zone string.
        transpose: if True, rotate scan direction 90° (for warp-weft second pass).

    Returns:
        Ordered list of LatLon waypoints inside the polygon.
    """

    # Accept both PointLatLon (Pydantic) and LatLon (dataclass)
    def _lat(v):
        return v.lat

    def _lon(v):
        return v.lon

    poly_e_list = []
    poly_n_list = []
    for v in polygon_latlon:
        e, n, _ = latlon_to_utm(_lat(v), _lon(v))
        poly_e_list.append(e)
        poly_n_list.append(n)

    poly_e = np.array(poly_e_list)
    poly_n = np.array(poly_n_list)

    if transpose:
        poly_e, poly_n = poly_n, poly_e

    # Determine scan orientation so the first waypoint is nearest prefer_start.
    # flip_e: scan east→west instead of west→east (enter from E side)
    # flip_n: even strips go north→south instead of south→north (enter from N side)
    if prefer_start is not None:
        ps_e, ps_n, _ = latlon_to_utm(prefer_start.lat, prefer_start.lon)
        sq_dists = (poly_e - ps_e) ** 2 + (poly_n - ps_n) ** 2
        ci = int(np.argmin(sq_dists))
        mid_e = (float(poly_e.min()) + float(poly_e.max())) / 2
        mid_n = (float(poly_n.min()) + float(poly_n.max())) / 2
        flip_e = bool(poly_e[ci] > mid_e)
        flip_n = bool(poly_n[ci] > mid_n)
    else:
        flip_e = flip_n = False

    if sweep_spacing_m < MIN_SWEEP_SPACING_M:
        logger.warning(
            "Sweep spacing %.1f m is below minimum %.1f m — clamped.",
            sweep_spacing_m,
            MIN_SWEEP_SPACING_M,
        )
    spacing = max(sweep_spacing_m, MIN_SWEEP_SPACING_M)
    min_e, max_e = float(poly_e.min()), float(poly_e.max())

    n_strips = max(1, math.ceil((max_e - min_e) / spacing))
    strip_xs = [min_e + spacing * (i + 0.5) for i in range(n_strips)]
    if flip_e:
        strip_xs = list(reversed(strip_xs))

    # Phase 1 — collect strips as separate lists
    strips: list[list[tuple[float, float]]] = []

    for i, sx in enumerate(strip_xs):
        crossings: list[float] = []
        n_verts = len(poly_e)
        j = n_verts - 1
        for vi in range(n_verts):
            e0_, n0_ = poly_e[vi], poly_n[vi]
            e1_, n1_ = poly_e[j], poly_n[j]
            if (e0_ <= sx < e1_) or (e1_ <= sx < e0_):
                t = (sx - e0_) / (e1_ - e0_ + 1e-15)
                crossings.append(float(n0_ + t * (n1_ - n0_)))
            j = vi

        if len(crossings) < 2:
            continue

        crossings.sort()
        strip_pts: list[tuple[float, float]] = []
        for k in range(0, len(crossings) - 1, 2):
            seg_n_start = crossings[k]
            seg_n_end = crossings[k + 1]
            if seg_n_end <= seg_n_start:
                continue
            seg_len = seg_n_end - seg_n_start
            n_pts = max(2, math.ceil(seg_len / spacing) + 1)
            ns = np.linspace(seg_n_start, seg_n_end, n_pts)
            if (i % 2 == 1) ^ flip_n:
                ns = ns[::-1]
            strip_pts.extend((sx, float(ny)) for ny in ns)

        if strip_pts:
            strips.append(strip_pts)

    if not strips:
        return []

    # Phase 2 — point-in-polygon filter (preserving strip boundaries)
    all_flat = [pt for s in strips for pt in s]
    wp_e = np.array([w[0] for w in all_flat])
    wp_n = np.array([w[1] for w in all_flat])
    rng = np.random.default_rng(seed=0)
    jitter = rng.uniform(-1e-4, 1e-4, size=wp_e.shape)
    inside_mask = points_in_polygon_utm(wp_e + jitter, wp_n + jitter, poly_e, poly_n)

    filtered_strips: list[list[tuple[float, float]]] = []
    idx = 0
    for strip in strips:
        n = len(strip)
        filtered = [pt for pt, ok in zip(strip, inside_mask[idx : idx + n]) if ok]
        if filtered:
            filtered_strips.append(filtered)
        idx += n

    if not filtered_strips:
        return []

    # Phase 3 — join strips with 90° corner waypoints (no U-turns)
    #
    # A plain lateral-first corner (next_x, current_end_n) causes a U-turn when
    # the polygon clips the next strip so its entry point is "beyond" the corner
    # in the scan direction.  Fix: use the more extreme northing as the junction
    # level, inserting up to two waypoints so the drone always enters the next
    # strip already travelling in the correct direction.
    #
    #  going_up case, next strip clips higher:
    #    ... → strip[-1] → (strip_x, junction_n) → next_strip[0] → down ...
    #  going_up case, current strip clips higher:
    #    ... → strip[-1] → (next_x, junction_n) → next_strip[0] → down ...
    #
    # Corner points are after the polygon filter, so they may lie outside it.
    all_wps_local: list[tuple[float, float]] = []
    for i, strip in enumerate(filtered_strips):
        all_wps_local.extend(strip)
        if i < len(filtered_strips) - 1:
            next_strip = filtered_strips[i + 1]
            going_up = len(strip) < 2 or strip[-1][1] >= strip[-2][1]
            junction_n = (
                max(strip[-1][1], next_strip[0][1])
                if going_up
                else min(strip[-1][1], next_strip[0][1])
            )
            # Vertical extension: bring current strip to junction level
            if abs(junction_n - strip[-1][1]) > 1e-6:
                all_wps_local.append((strip[-1][0], junction_n))
            # Lateral corner: only needed when next strip doesn't start at junction
            if abs(junction_n - next_strip[0][1]) > 1e-6:
                all_wps_local.append((next_strip[0][0], junction_n))

    # Un-transpose: swap (scan_e, scan_n) back to (easting, northing)
    if transpose:
        all_wps_local = [(w[1], w[0]) for w in all_wps_local]

    return [utm_to_latlon_obj(e, n, zone_str) for e, n in all_wps_local]


# ── Entry bearing ─────────────────────────────────────────────────────────────


def compute_entry_bearing(previous_point: LatLon, zone_entry_point: LatLon) -> float:
    """Return the bearing (degrees from North) from previous_point to zone_entry_point."""
    e0, n0, _ = latlon_to_utm(previous_point.lat, previous_point.lon)
    e1, n1, _ = latlon_to_utm(zone_entry_point.lat, zone_entry_point.lon)
    return math.degrees(math.atan2(e1 - e0, n1 - n0)) % 360.0


# ── PoiZone factory ───────────────────────────────────────────────────────────


def build_poi_zone(
    poi_config: POIConfig,
    global_band: AltitudeBand,
    zone_str: str,
    poi_index: int,
    entry_bearing_deg: float = 0.0,
) -> PoiZone:
    """Construct a PoiZone from a POIConfig.

    The zone boundary is the maneuver area polygon (custom polygon or bounding
    rectangle). The band resolves per-POI overrides against the global band.

    entry_bearing_deg is used to rotate the bounding rectangle so it matches the
    actual lawnmower sweep orientation. warp_weft is always axis-aligned (0°/90°)
    so entry_bearing is ignored for that maneuver type.
    """
    m = poi_config.maneuver

    # Resolve band
    poi_min = m.poi_min_agl_m if m.poi_min_agl_m is not None else global_band.min_agl_m
    poi_max = m.poi_max_agl_m if m.poi_max_agl_m is not None else global_band.max_agl_m
    band = AltitudeBand(min_agl_m=poi_min, max_agl_m=poi_max)

    center = LatLon(lat=poi_config.point.lat, lon=poi_config.point.lon)

    # Resolve boundary polygon
    if m.polygon:
        boundary = tuple(LatLon(lat=v.lat, lon=v.lon) for v in m.polygon)
    elif m.type in (ManeuverType.LAWNMOWER, ManeuverType.SMART_LAWNMOWER):
        # Rotate the bounding rectangle to match the lawnmower sweep direction.
        # warp_weft generates two axis-aligned passes (0° and 90°) so no rotation needed.
        boundary = _rectangle_boundary(
            center=center,
            width_m=m.width_m,
            height_m=m.height_m,
            zone_str=zone_str,
            entry_bearing_deg=entry_bearing_deg,
        )
    else:
        boundary = _rectangle_boundary(
            center=center,
            width_m=m.width_m,
            height_m=m.height_m,
            zone_str=zone_str,
        )

    return PoiZone(
        boundary_latlon=boundary,
        band=band,
        zone_id=f"POI-{poi_index + 1}",
    )


def _rectangle_boundary(
    center: LatLon,
    width_m: float,
    height_m: float,
    zone_str: str,
    entry_bearing_deg: float = 0.0,
) -> tuple[LatLon, ...]:
    """Return a 4-vertex LatLon polygon for a rectangle centred on center.

    entry_bearing_deg rotates the rectangle using the same convention as
    generate_lawnmower_pattern: width runs cross-track (perpendicular to bearing)
    and height runs along-track (parallel to bearing).
    """
    e0, n0, _ = latlon_to_utm(center.lat, center.lon)
    hw = width_m / 2.0
    hh = height_m / 2.0
    bearing_rad = math.radians(entry_bearing_deg)
    cos_b = math.cos(bearing_rad)
    sin_b = math.sin(bearing_rad)

    def _rotate(e_local: float, n_local: float) -> tuple[float, float]:
        return (
            e0 + e_local * cos_b - n_local * sin_b,
            n0 + e_local * sin_b + n_local * cos_b,
        )

    corners_utm = [
        _rotate(-hw, -hh),
        _rotate(+hw, -hh),
        _rotate(+hw, +hh),
        _rotate(-hw, +hh),
    ]
    return tuple(utm_to_latlon_obj(e, n, zone_str) for e, n in corners_utm)
