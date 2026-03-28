"""
Convert route arrays to the waypoints.json output format.
"""

from __future__ import annotations

import json

import numpy as np

from core.utm_utils import utm_to_latlon
from models import WaypointOut


def to_waypoints_json(
    utm_points: np.ndarray,
    altitudes: np.ndarray,
    headings: np.ndarray,
    zone_str: str,
    speed_ms: float,
    actions: list[str] | None = None,
) -> list[dict]:
    """Build the waypoints list.

    Args:
        utm_points: (N, 2) array of [easting, northing]
        altitudes: (N,) MSL altitudes in metres
        headings: (N,) forward bearings in degrees
        zone_str: UTM zone string e.g. "32N"
        speed_ms: cruise speed — assigned to all points
        actions: per-point action label; defaults to "waypoint" for all

    Returns:
        List of dicts matching the WaypointOut schema.
    """
    n = len(utm_points)
    if actions is None:
        actions = ["waypoint"] * n
    elif len(actions) < n:
        actions = list(actions) + ["waypoint"] * (n - len(actions))

    waypoints: list[dict] = []
    for i in range(n):
        e = float(utm_points[i, 0])
        n_coord = float(utm_points[i, 1])
        lat, lon = utm_to_latlon(e, n_coord, zone_str)
        wp = WaypointOut(
            lat=round(lat, 8),
            lon=round(lon, 8),
            utm_e=round(e, 2),
            utm_n=round(n_coord, 2),
            utm_zone=zone_str,
            alt_m=round(float(altitudes[i]), 2),
            heading_deg=round(float(headings[i]), 1),
            speed_ms=speed_ms,
            action=actions[i],
        )
        waypoints.append(wp.model_dump())

    return waypoints


def serialise_waypoints_json(waypoints: list[dict]) -> str:
    """Serialise waypoint list to a JSON string."""
    return json.dumps(waypoints, indent=2)
