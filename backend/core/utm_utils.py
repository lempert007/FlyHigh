"""
Shared UTM ↔ WGS-84 conversion helpers and distance utilities.

All backend modules should import from here instead of duplicating these
one-liners.  The functions are intentionally thin wrappers around the `utm`
library so the rest of the code never imports `utm` directly.
"""

from __future__ import annotations

import math

import utm

from core.types import LatLon


def latlon_to_utm(
    lat: float,
    lon: float,
    expected_zone: str | None = None,
) -> tuple[float, float, str]:
    """Convert WGS-84 lat/lon to UTM (easting, northing, zone_str).

    If *expected_zone* is given and the point falls in a different zone,
    raises ValueError — callers use this to enforce single-zone missions.
    """
    easting, northing, zone_number, zone_letter = utm.from_latlon(lat, lon)
    zone_str = f"{zone_number}{zone_letter}"
    if expected_zone is not None and zone_str != expected_zone:
        raise ValueError(
            f"Point ({lat}, {lon}) falls in zone {zone_str}, "
            f"but mission zone is {expected_zone}. "
            "Split the mission or adjust points to stay within one UTM zone."
        )
    return easting, northing, zone_str


def utm_to_latlon(easting: float, northing: float, zone_str: str) -> tuple[float, float]:
    """Convert UTM (easting, northing, zone_str) to WGS-84 (lat, lon)."""
    zone_number = int(zone_str[:-1])
    zone_letter = zone_str[-1]
    lat, lon = utm.to_latlon(easting, northing, zone_number, northern=(zone_letter >= "N"))
    return lat, lon


def utm_to_latlon_obj(easting: float, northing: float, zone_str: str) -> LatLon:
    """Like utm_to_latlon but returns a LatLon dataclass."""
    lat, lon = utm_to_latlon(easting, northing, zone_str)
    return LatLon(lat=lat, lon=lon)


def approx_distance_m(p1: LatLon, p2: LatLon) -> float:
    """Fast flat-earth approximation of distance in metres between two LatLon points.

    Accurate to ~0.1 % for distances under 100 km. Used where sub-metre precision
    is not required (band-crossing search, leg-length for slope constraints).
    """
    lat_m = 111_320.0
    lon_m = 111_320.0 * math.cos(math.radians((p1.lat + p2.lat) / 2))
    return math.hypot((p2.lat - p1.lat) * lat_m, (p2.lon - p1.lon) * lon_m)


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in metres between two WGS-84 points."""
    R = 6_371_000.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    )
    return 2 * R * math.asin(math.sqrt(a))
