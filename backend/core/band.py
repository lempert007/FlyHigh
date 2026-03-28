"""
Altitude band lookup and zone-crossing detection.

band_at() is the single authoritative source for which AltitudeBand applies at
any geographic point. No other module may reimplement band selection.
"""

from __future__ import annotations

import math

import numpy as np

import config
from core.geometry import points_in_polygon_utm
from core.types import AltitudeBand, LatLon, PoiZone, ZoneCrossing

_EPSILON = 1e-15  # tiny jitter to avoid degenerate on-edge cases in ray-casting


# ── Point-in-polygon ──────────────────────────────────────────────────────────

def _point_in_polygon(lat: float, lon: float, poly: tuple[LatLon, ...]) -> bool:
    """Ray-casting point-in-polygon test for a single point against a LatLon polygon.

    Uses a tiny jitter to avoid degenerate on-edge cases.
    """
    if len(poly) < 3:
        return False
    # Project to a flat grid (degrees are fine for a local bounding check)
    px, py = lon + 1e-9, lat + 1e-9  # tiny jitter for robustness
    inside = False
    n = len(poly)
    j = n - 1
    for i in range(n):
        xi, yi = poly[i].lon, poly[i].lat
        xj, yj = poly[j].lon, poly[j].lat
        if ((yi > py) != (yj > py)) and (px < (xj - xi) * (py - yi) / (yj - yi + _EPSILON) + xi):
            inside = not inside
        j = i
    return inside


# ── Public API ────────────────────────────────────────────────────────────────

def band_at(
    point: LatLon,
    poi_zones: list[PoiZone],
    global_band: AltitudeBand,
) -> AltitudeBand:
    """Return the AltitudeBand applicable at point.

    Checks POI zones first (first match wins); falls back to global_band.
    """
    for zone in poi_zones:
        if _point_in_polygon(point.lat, point.lon, zone.boundary_latlon):
            return zone.band
    return global_band


def find_zone_crossings(
    leg_start: LatLon,
    leg_end: LatLon,
    poi_zones: list[PoiZone],
    global_band: AltitudeBand,
    spacing_m: float = config.ZONE_CROSSING_SEARCH_RESOLUTION_M,
) -> list[ZoneCrossing]:
    """Return all points along leg_start→leg_end where the active band changes.

    Algorithm: sample the leg at spacing_m, detect adjacent samples with different
    bands, binary-search to locate the crossing to within 0.1 m, return ZoneCrossing.

    Results are sorted by distance from leg_start.
    """
    dlat = leg_end.lat - leg_start.lat
    dlon = leg_end.lon - leg_start.lon
    leg_len_deg = math.hypot(dlat, dlon)

    # Convert rough degree length to metres (approx)
    ref_lat = (leg_start.lat + leg_end.lat) / 2
    lat_m = 111_320.0
    lon_m = 111_320.0 * math.cos(math.radians(ref_lat))
    leg_len_m = math.hypot(dlat * lat_m, dlon * lon_m)

    if leg_len_m < 1e-3:
        return []

    n_pts = max(2, math.ceil(leg_len_m / spacing_m) + 1)
    ts = np.linspace(0.0, 1.0, n_pts)
    dists = ts * leg_len_m

    lats = leg_start.lat + ts * dlat
    lons = leg_start.lon + ts * dlon

    # Determine band at each sample
    points = [LatLon(lat=float(lats[i]), lon=float(lons[i])) for i in range(n_pts)]
    bands = [band_at(p, poi_zones, global_band) for p in points]

    crossings: list[ZoneCrossing] = []
    for i in range(1, n_pts):
        if bands[i] == bands[i - 1]:
            continue
        # Binary search for the precise crossing between dists[i-1] and dists[i]
        lo, hi = float(dists[i - 1]), float(dists[i])
        band_lo = bands[i - 1]
        while hi - lo > 0.1:
            mid = (lo + hi) / 2.0
            t_mid = mid / leg_len_m
            p_mid = LatLon(
                lat=leg_start.lat + t_mid * dlat,
                lon=leg_start.lon + t_mid * dlon,
            )
            if band_at(p_mid, poi_zones, global_band) == band_lo:
                lo = mid
            else:
                hi = mid

        cross_dist = (lo + hi) / 2.0
        t_cross = cross_dist / leg_len_m
        cross_point = LatLon(
            lat=leg_start.lat + t_cross * dlat,
            lon=leg_start.lon + t_cross * dlon,
        )
        crossings.append(ZoneCrossing(
            point=cross_point,
            distance_along_leg_m=cross_dist,
            band_before=bands[i - 1],
            band_after=bands[i],
        ))

    return crossings
