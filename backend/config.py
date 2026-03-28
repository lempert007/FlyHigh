"""
Physical constants and application defaults for FlyHigh.
Every magic number in the codebase must be defined here with a comment.
"""

# ── Altitude limits (metres AGL) ──────────────────────────────────────────────
DEFAULT_MIN_AGL_M: float = 15.0
"""Minimum height above ground level — keeps footage stable and in legal airspace."""

DEFAULT_MAX_AGL_M: float = 80.0
"""Maximum height above ground level — limits how far the drone climbs."""

DEFAULT_POINT_RADIUS_M: float = 5.0
"""Horizontal safety bubble radius around each waypoint — catches vertical walls."""

DEFAULT_MAX_SURFACE_RADIUS_M: float = DEFAULT_POINT_RADIUS_M
"""Camera-range check radius (metres). Within this horizontal bubble the drone must not
be more than max_agl_m above the lowest local DSM surface."""

# ── Performance ───────────────────────────────────────────────────────────────
DEFAULT_CRUISE_SPEED_MS: float = 8.0
"""Nominal horizontal cruising speed in m/s — typical for cinema drones."""

DEFAULT_CLIMB_RATE_MS: float = 3.0
"""Maximum sustained vertical climb rate in m/s."""

DEFAULT_MAX_SLOPE_RATIO: float | None = None
"""Maximum altitude change per metre of horizontal distance (m/m). None = auto-derive
from climb_rate_ms / cruise_speed_ms. Set e.g. 0.3 to cap at 1:3.3 regardless of speeds."""

DEFAULT_SPACING_M: float = 5.0
"""Distance between adjacent computed route points in metres — controls output resolution."""

# ── Battery / weight ──────────────────────────────────────────────────────────
DEFAULT_BATTERY_WH: float = 200.0
"""Total usable battery energy in Watt-hours."""

DEFAULT_DRONE_WEIGHT_KG: float = 1.5
"""All-up drone mass in kilograms — used in the power model."""


# ── Physics ───────────────────────────────────────────────────────────────────
GRAVITY_MS2: float = 9.81
"""Standard gravitational acceleration in m/s²."""

AIR_DENSITY_KGM3: float = 1.225
"""International Standard Atmosphere sea-level air density in kg/m³."""

HOVER_EFFICIENCY: float = 0.70
"""Combined motor + propeller efficiency factor for horizontal flight power model."""

POWER_COEFF: float = 1.5
"""Exponent in horizontal power model: P_horiz ∝ weight_kg^POWER_COEFF."""

# ── Terrain interpolation ─────────────────────────────────────────────────────
NODATA_FILL: float = float("nan")
"""Value used to fill masked / nodata cells in raster arrays before interpolation."""

ZONE_CROSSING_SEARCH_RESOLUTION_M: float = 1.0
"""Sampling interval (metres) for finding zone-boundary crossings along a leg.
Finer values give more precise crossing locations at the cost of more terrain queries."""

FLAT_LEG_SAMPLE_SPACING_M: float = 2.0
"""Sampling interval used when computing peak terrain along a flat leg.
Should be ≤ half the terrain raster resolution to avoid missing narrow terrain spikes."""

# ── 3-D render ────────────────────────────────────────────────────────────────
DEM_GRID_SIZE: int = 80
"""Number of grid points along each axis when sampling the DSM for 3-D visualisation."""

DEM_PADDING_M: float = 300.0
"""Metres of terrain padding added around the mission bounding box in 3-D renders."""


LAWNMOWER_TURN_OVERLAP: float = 0.10
"""Extra overlap fraction added at strip turns to avoid coverage gaps."""

# ── Mission library ───────────────────────────────────────────────────────────
from pathlib import Path as _Path

MISSIONS_ROOT: _Path = _Path(__file__).parent / "missions"
"""Root folder where mission sub-directories are stored."""

# ── Session management ────────────────────────────────────────────────────────
SESSION_TTL_SECONDS: int = 3600
"""How long an upload session is kept alive in memory before being pruned."""

MAX_SESSIONS: int = 50
"""Hard cap on concurrent sessions. Oldest session is evicted when exceeded."""

# ── Smart Route ───────────────────────────────────────────────────────────────
SMART_ROUTE_CORRIDOR_M: float = 50.0
"""Maximum perpendicular offset (metres) tried when Smart Route lateral optimisation
shifts a transit segment to seek flatter terrain."""

SMART_ROUTE_LATERAL_SAMPLES: int = 11
"""Number of lateral offset values sampled in Smart Route mode, linearly spaced
from -SMART_ROUTE_CORRIDOR_M to +SMART_ROUTE_CORRIDOR_M."""

# ── Safety check ─────────────────────────────────────────────────────────────
BUBBLE_SAMPLE_COUNT: int = 36
"""Number of azimuth samples used when checking the horizontal safety bubble."""

# ── Warnings / errors ────────────────────────────────────────────────────────
BATTERY_WARNING_PCT: float = 90.0
"""Budget percentage above which an amber warning is surfaced."""

BATTERY_ERROR_PCT: float = 100.0
"""Budget percentage above which a red error is surfaced (route still returned)."""

# ── Session management ────────────────────────────────────────────────────────
SESSION_PRUNE_INTERVAL_S: int = 300
"""How often (seconds) the background task sweeps for and removes expired sessions."""

# ── TIFF library ───────────────────────────────────────────────────────────────
TIFF_LIBRARY_PATH: _Path = _Path(__file__).parent / "maps"
"""Folder containing pre-loaded GeoTIFF terrain files available for selection."""

# ── Altitude validation ────────────────────────────────────────────────────────
AGL_VALIDATION_EPSILON_M: float = 0.1
"""Tolerance (metres) applied when checking AGL bounds, to suppress floating-point
rounding violations at exact band boundaries."""

CAMERA_RANGE_EPSILON_M: float = 1.0
"""Tolerance (metres) for the camera-range check. Being up to 1 m above max_agl_m
is acceptable — the check is a product-quality concern, not a crash risk."""


def _validate() -> None:
    """Assert invariants on constants at import time to catch misconfiguration early."""
    assert TIFF_LIBRARY_PATH.is_dir(), f"TIFF_LIBRARY_PATH {TIFF_LIBRARY_PATH!r} does not exist"
    assert MISSIONS_ROOT.is_dir(), f"MISSIONS_ROOT {MISSIONS_ROOT!r} does not exist"
    assert DEFAULT_MIN_AGL_M > 0, "DEFAULT_MIN_AGL_M must be positive"
    assert DEFAULT_MAX_AGL_M > DEFAULT_MIN_AGL_M, "DEFAULT_MAX_AGL_M must exceed DEFAULT_MIN_AGL_M"
    assert DEFAULT_POINT_RADIUS_M >= 0, "DEFAULT_POINT_RADIUS_M must be non-negative"
    assert DEFAULT_SPACING_M > 0, "DEFAULT_SPACING_M must be positive"
    assert DEFAULT_CRUISE_SPEED_MS > 0, "DEFAULT_CRUISE_SPEED_MS must be positive"
    assert DEFAULT_CLIMB_RATE_MS > 0, "DEFAULT_CLIMB_RATE_MS must be positive"
    assert DEFAULT_BATTERY_WH > 0, "DEFAULT_BATTERY_WH must be positive"
    assert DEFAULT_DRONE_WEIGHT_KG > 0, "DEFAULT_DRONE_WEIGHT_KG must be positive"
    assert 0 < HOVER_EFFICIENCY <= 1, "HOVER_EFFICIENCY must be in (0, 1]"
    assert SMART_ROUTE_CORRIDOR_M > 0, "SMART_ROUTE_CORRIDOR_M must be positive"
    assert SESSION_TTL_SECONDS > 0, "SESSION_TTL_SECONDS must be positive"


_validate()
