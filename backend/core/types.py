"""
Shared data structures for the FlyHigh planning pipeline.

Every module imports types from here. No module may define its own local copies
of these structures.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from enum import Enum
from typing import TYPE_CHECKING

import numpy as np

if TYPE_CHECKING:
    from core.terrain import TerrainIndex


# ── Geographic primitives ─────────────────────────────────────────────────────

@dataclass(frozen=True)
class LatLon:
    lat: float  # degrees WGS84
    lon: float  # degrees WGS84


@dataclass(frozen=True)
class UtmPoint:
    easting: float   # metres
    northing: float  # metres
    zone_str: str    # e.g. "32N"


# ── Altitude model ────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class AltitudeBand:
    min_agl_m: float  # metres above ground
    max_agl_m: float  # metres above ground


@dataclass(frozen=True)
class Waypoint3D:
    lat: float
    lon: float
    alt_msl: float  # metres MSL
    action: str     # "waypoint" | "poi" | "lawnmower" | "warp_weft" | "land" | "zone_crossing"


# ── Terrain sampling ──────────────────────────────────────────────────────────

@dataclass(frozen=True)
class TerrainSample:
    distance_m: float       # metres from leg start
    elevation_msl: float    # metres MSL


@dataclass
class TerrainProfile:
    samples: list[TerrainSample]

    def peak_elevation_msl(self) -> float:
        """Return the maximum terrain MSL elevation in the profile."""
        if not self.samples:
            return 0.0
        return max(s.elevation_msl for s in self.samples)

    def valley_elevation_msl(self) -> float:
        """Return the minimum terrain MSL elevation in the profile."""
        if not self.samples:
            return 0.0
        return min(s.elevation_msl for s in self.samples)



# ── Zone model ────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class PoiZone:
    boundary_latlon: tuple[LatLon, ...]  # closed polygon defining zone extent
    band: AltitudeBand                   # the band that applies inside this zone
    zone_id: str                         # human-readable label for violation messages


@dataclass(frozen=True)
class ZoneCrossing:
    point: LatLon                  # geographic location of the crossing
    distance_along_leg_m: float    # metres from leg start
    band_before: AltitudeBand
    band_after: AltitudeBand


# ── Violations ────────────────────────────────────────────────────────────────

class ViolationTier(str, Enum):
    HARD = "hard"  # blocks safe flight; still returned, never raises
    SOFT = "soft"  # advisory only


@dataclass(frozen=True)
class Violation:
    tier: ViolationTier
    kind: str              # "vertical" | "slope" | "surface_radius" | "agl"
    location: LatLon
    message: str
    measured_value: float  # what was observed (e.g. required climb slope)
    limit_value: float     # what was allowed


# ── Flight parameters ─────────────────────────────────────────────────────────

@dataclass(frozen=True)
class FlightParams:
    min_agl_m: float
    max_agl_m: float
    cruise_speed_ms: float
    climb_rate_ms: float
    spacing_m: float                    # route densification spacing
    battery_wh: float
    drone_weight_kg: float
    point_radius_m: float
    max_surface_radius_m: float         # 0 = disabled; >0 = HARD camera-range check
    takeoff_alt_msl: float | None       # None → auto-derive from terrain + min_agl
    optimize_poi_order: bool
    smart_route_corridor_m: float | None  # None → Smart Route disabled
    min_step_m: float                   # suppress descent steps smaller than this value
    max_slope_ratio: float | None       # explicit m/m override; None = derive from speeds

    @property
    def max_climb_slope(self) -> float:
        """Maximum altitude change per metre of horizontal distance (m/m).

        Uses max_slope_ratio directly when set; otherwise derives from
        climb_rate_ms / cruise_speed_ms.
        """
        if self.max_slope_ratio is not None:
            return self.max_slope_ratio
        return self.climb_rate_ms / self.cruise_speed_ms


# ── Pipeline I/O ──────────────────────────────────────────────────────────────

@dataclass
class MissionInput:
    dsm: "TerrainIndex"                    # surface model (obstacles)
    dtm: "TerrainIndex"                    # bare-ground model (altitude floor)
    start: LatLon
    waypoints: list[LatLon]
    poi_zones: list[PoiZone]              # zone definitions with band overrides
    poi_2d_waypoints: list[list[LatLon]]  # parallel to poi_zones: interior 2-D pattern
    landing: LatLon
    params: FlightParams
    # Per-check terrain overrides (resolved in plan.py; default to dsm when None)
    bubble_terrain: "TerrainIndex | None" = None   # horizontal safety bubble check
    camera_terrain: "TerrainIndex | None" = None   # camera-range check


@dataclass
class MissionResult:
    waypoints_3d: list[Waypoint3D]
    dense_utm: np.ndarray        # shape (N, 2): columns are easting, northing
    violations: list[Violation]
    total_distance_m: float
    flight_time_s: float
    energy_wh: float
    budget_pct: float
    terrain_resolution_m: float | None
    covered_area_m2: float | None
    smart_route_summary: str | None
    pre_smart_route_utm: np.ndarray | None  # UTM points before lateral shift; None when Smart Route off
