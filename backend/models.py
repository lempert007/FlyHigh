"""
Pydantic v2 models for all API request / response shapes.
All default values are imported from config.py — never hardcoded here.
"""

from __future__ import annotations

from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator

import config

# ── Shared coordinate type ────────────────────────────────────────────────────


class PointLatLon(BaseModel):
    lat: float = Field(..., ge=-90.0, le=90.0, description="Latitude in decimal degrees (WGS84)")
    lon: float = Field(..., ge=-180.0, le=180.0, description="Longitude in decimal degrees (WGS84)")


# ── Maneuver configuration ────────────────────────────────────────────────────


class ManeuverConfig(BaseModel):
    type: Literal["lawnmower", "warp_weft"] = "lawnmower"

    # lawnmower / warp_weft params
    width_m: float = Field(
        default=100.0, gt=0, description="Coverage area width in metres (cross-track)"
    )
    height_m: float = Field(
        default=100.0, gt=0, description="Coverage area height in metres (along-track)"
    )
    sweep_spacing_m: float = Field(
        default=30.0, ge=30, description="Distance between adjacent sweep strips in metres"
    )

    # per-POI altitude override (None = use global FlightConfig value)
    poi_min_agl_m: float | None = Field(
        default=None, gt=0, description="POI-specific minimum AGL in metres (overrides global)"
    )
    poi_max_agl_m: float | None = Field(
        default=None, gt=0, description="POI-specific maximum AGL in metres (overrides global)"
    )

    # custom polygon area (replaces width_m × height_m for lawnmower / warp_weft)
    polygon: list[PointLatLon] | None = Field(
        default=None,
        description="Custom polygon vertices (lat/lon). If set, replaces width_m × height_m for lawnmower/warp_weft.",
    )

    @model_validator(mode="after")
    def check_poi_agl_constraints(self) -> ManeuverConfig:
        has_min = self.poi_min_agl_m is not None
        has_max = self.poi_max_agl_m is not None
        if has_min != has_max:
            raise ValueError("poi_min_agl_m and poi_max_agl_m must both be set or both be unset")
        if has_min and has_max and self.poi_min_agl_m >= self.poi_max_agl_m:  # type: ignore[operator]
            raise ValueError("poi_min_agl_m must be strictly less than poi_max_agl_m")
        return self


class POIConfig(BaseModel):
    name: str | None = Field(
        default=None, description="Optional human-readable POI name for mission logs"
    )
    point: PointLatLon
    maneuver: ManeuverConfig = Field(default_factory=ManeuverConfig)


# ── Flight configuration ──────────────────────────────────────────────────────


class FlightConfig(BaseModel):
    min_agl_m: float = Field(
        default=config.DEFAULT_MIN_AGL_M,
        gt=0,
        description="Minimum altitude above ground level in metres",
    )
    max_agl_m: float = Field(
        default=config.DEFAULT_MAX_AGL_M,
        gt=0,
        description="Maximum altitude above ground level in metres",
    )
    point_radius_m: float = Field(
        default=config.DEFAULT_POINT_RADIUS_M,
        gt=0,
        description="Horizontal safety bubble radius in metres — HARD violation if any obstacle "
        "within this radius exceeds drone altitude.",
    )
    max_surface_radius_m: float = Field(
        default=config.DEFAULT_MAX_SURFACE_RADIUS_M,
        ge=0,
        description="Camera-range check radius in metres. HARD violation if drone altitude exceeds "
        "the lowest terrain surface within this radius by more than max_agl_m. "
        "Typically smaller than point_radius_m.",
    )
    cruise_speed_ms: float = Field(
        default=config.DEFAULT_CRUISE_SPEED_MS,
        gt=0,
        description="Horizontal cruise speed in m/s",
    )
    climb_rate_ms: float = Field(
        default=config.DEFAULT_CLIMB_RATE_MS,
        gt=0,
        description="Maximum vertical climb rate in m/s",
    )
    spacing_m: float = Field(
        default=config.DEFAULT_SPACING_M,
        gt=0,
        description="Route point spacing in metres",
    )
    battery_wh: float = Field(
        default=config.DEFAULT_BATTERY_WH,
        gt=0,
        description="Total usable battery capacity in Watt-hours",
    )
    drone_weight_kg: float = Field(
        default=config.DEFAULT_DRONE_WEIGHT_KG,
        gt=0,
        description="All-up drone mass in kilograms",
    )

    smart_route: bool = Field(
        default=False,
        description="Enable Smart Route lateral path optimisation — shifts transit segments "
        "perpendicular to the flight axis to seek flatter terrain.",
    )
    smart_route_corridor_m: float = Field(
        default=config.SMART_ROUTE_CORRIDOR_M,
        gt=0,
        description="Maximum perpendicular offset in metres tried during Smart Route lateral optimisation.",
    )
    optimize_poi_order: bool = Field(
        default=False,
        description="Reorder POIs by greedy nearest-neighbor TSP before planning to minimise total transit distance.",
    )
    min_altitude_step_m: float = Field(
        default=2.0,
        ge=0.0,
        description="Suppress altitude descents smaller than this value in metres. "
        "Higher = fewer staircase steps. 0 = tightest terrain following.",
    )
    max_slope_ratio: float | None = Field(
        default=config.DEFAULT_MAX_SLOPE_RATIO,
        gt=0.0,
        description="Maximum altitude change per metre of horizontal distance (m/m). "
        "Overrides the auto-derived value of climb_rate_ms / cruise_speed_ms. "
        "Example: 0.3 = 1 m climb per 3.3 m horizontal. None = auto.",
    )

    safety_radius_terrain: Literal["DSM", "DTM"] = Field(
        default="DSM",
        description="Which terrain type the horizontal safety bubble (point_radius_m) check samples. "
        "DSM includes buildings and trees; DTM is bare ground.",
    )
    camera_range_terrain: Literal["DSM", "DTM"] = Field(
        default="DTM",
        description="Which terrain type the camera-range (max_surface_radius_m) check samples. "
        "DTM gives bare-ground clearance; DSM accounts for surface objects.",
    )

    @model_validator(mode="after")
    def check_constraints(self) -> FlightConfig:
        if self.min_agl_m >= self.max_agl_m:
            raise ValueError("min_agl_m must be strictly less than max_agl_m")
        return self


# ── Route request ─────────────────────────────────────────────────────────────


class RouteRequest(BaseModel):
    session_id: str = Field(..., description="Session ID returned by POST /upload")
    name: str = Field(
        default="", description="Optional mission name — used in output filenames and log"
    )
    notes: str = Field(
        default="", description="Optional free-text notes included in the mission log"
    )
    start: PointLatLon
    waypoints: list[PointLatLon] = Field(default_factory=list)
    pois: list[POIConfig] = Field(..., min_length=1)
    landing: PointLatLon
    config: FlightConfig = Field(default_factory=FlightConfig)
    takeoff_alt_m: float | None = Field(
        default=None,
        gt=0,
        description="Fixed MSL altitude for takeoff/start. If None, derived from terrain + min_agl_m.",
    )


# ── TIFF library selection ────────────────────────────────────────────────────


class TiffSelection(BaseModel):
    name: str = Field(..., description="Filename only — no path components")
    type: Literal["DSM", "DTM"] = "DSM"


class ActivateRequest(BaseModel):
    selections: list[TiffSelection] = Field(..., min_length=1)


# ── Upload response ───────────────────────────────────────────────────────────


class FileInfo(BaseModel):
    name: str
    resolution_m: float = Field(description="Ground sample distance in metres")
    bbox: tuple[float, float, float, float] = Field(
        description="Bounding box (west, south, east, north) in WGS84 decimal degrees"
    )
    crs: str = Field(description="Coordinate reference system string")
    inferred_type: Literal["DSM", "DTM", "unknown"]


class UploadResponse(BaseModel):
    session_id: str
    files: list[FileInfo]
    notice: str | None = None


# ── Plan response (embedded in ZIP headers / response body for warnings) ──────


class ViolationInfo(BaseModel):
    point_index: int
    kind: Literal[
        "vertical", "horizontal", "surface_warning", "terrain_band", "slope", "camera_range"
    ]
    category: Literal["safety", "product_route", "product_poi"]
    description: str
    lat: float | None = None
    lon: float | None = None


class PlanMeta(BaseModel):
    total_distance_m: float
    flight_time_s: float
    energy_wh: float
    budget_pct: float
    violations: list[ViolationInfo] = Field(default_factory=list)
    warning: str | None = None
    error: str | None = None
    smart_route_summary: str | None = None
    terrain_resolution_m: float | None = None
    covered_area_m2: float | None = None
    min_clearance_m: float | None = None
    mean_clearance_m: float | None = None
    tight_segment_count: int | None = None
    min_agl_m: float | None = None
    max_agl_m: float | None = None
    poi_scan_good_pct: float | None = (
        None  # % of POI scan points within product spec; None when no POIs
    )
    rth_reserve_pct: float | None = None
    """Estimated emergency RTH energy as % of total battery (straight-line from furthest waypoint).
    None when the route has no waypoints. High values indicate limited abort margin."""


# ── Mission library ───────────────────────────────────────────────────────────


class MissionStatus(str, Enum):
    draft = "draft"
    ready = "ready"
    flown = "flown"


class MissionSummary(BaseModel):
    folder: str
    name: str
    status: MissionStatus
    created_at: str
    updated_at: str
    has_thumbnail: bool
    route_preview: dict | None = None  # {start, waypoints, pois} — compact lat/lon for SVG preview


class CreateMissionRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)


class SaveMissionRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    status: MissionStatus = MissionStatus.draft
    notes: str = ""
    tiff_selections: list[TiffSelection] = Field(default_factory=list)
    route: dict[str, Any] = Field(default_factory=dict)
    preset_name: str | None = Field(
        default=None, description="Name of the drone preset active when the mission was last saved"
    )


# ── Mission plan request bodies ───────────────────────────────────────────────


class SaveFromSessionBody(BaseModel):
    session_id: str


class AltEditBody(BaseModel):
    alt_overrides: list[float]


# ── Drone preset library ──────────────────────────────────────────────────────


class PresetItem(BaseModel):
    name: str = Field(..., min_length=1, description="Unique human-readable preset name")
    cruise_speed_ms: float = Field(..., gt=0)
    climb_rate_ms: float = Field(..., gt=0)
    battery_wh: float = Field(..., gt=0)
    drone_weight_kg: float = Field(..., gt=0)


# ── Dashboard aggregates ──────────────────────────────────────────────────────


class MissionPin(BaseModel):
    folder: str
    name: str
    status: MissionStatus
    created_at: str
    lat: float | None = None
    lon: float | None = None


class RecentMission(BaseModel):
    folder: str
    name: str
    status: MissionStatus
    updated_at: str


class DashboardStats(BaseModel):
    missions_by_status: dict[str, int]
    total_area_m2: float
    missions_with_area: int
    estimated_flight_hours: float
    most_used_preset: str | None
    recent_activity: list[RecentMission]
    mission_pins: list[MissionPin]


# ── Application settings ──────────────────────────────────────────────────────


class AppSettings(BaseModel):
    """Global application settings — stored in MISSIONS_ROOT/settings.json."""

    # Mission defaults applied to new missions
    default_min_agl_m: float = Field(
        default=config.DEFAULT_MIN_AGL_M,
        gt=0,
        description="Default minimum AGL for new missions (metres)",
    )
    default_max_agl_m: float = Field(
        default=config.DEFAULT_MAX_AGL_M,
        gt=0,
        description="Default maximum AGL for new missions (metres)",
    )
    default_spacing_m: float = Field(
        default=config.DEFAULT_SPACING_M,
        gt=0,
        description="Default route point spacing for new missions (metres)",
    )
    # Safety & warning thresholds
    battery_warning_pct: float = Field(
        default=config.BATTERY_WARNING_PCT,
        ge=0,
        le=200,
        description="Budget % above which an amber battery warning is shown",
    )
    battery_error_pct: float = Field(
        default=config.BATTERY_ERROR_PCT,
        ge=0,
        le=200,
        description="Budget % above which a red battery error is shown",
    )

    @model_validator(mode="after")
    def check_agl_constraints(self) -> AppSettings:
        if self.default_min_agl_m >= self.default_max_agl_m:
            raise ValueError("default_min_agl_m must be strictly less than default_max_agl_m")
        if self.battery_warning_pct > self.battery_error_pct:
            raise ValueError("battery_warning_pct must not exceed battery_error_pct")
        return self


# ── Waypoint output (one element of waypoints.json array) ────────────────────


class WaypointOut(BaseModel):
    lat: float
    lon: float
    utm_e: float
    utm_n: float
    utm_zone: str
    alt_m: float
    heading_deg: float
    speed_ms: float
    action: str
