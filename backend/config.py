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
import os as _os
from pathlib import Path as _Path

# Load .env file if present — no-op in production where env vars are injected directly.
_env_file = _Path(__file__).parent / ".env"
if _env_file.exists():
    for _line in _env_file.read_text().splitlines():
        _line = _line.strip()
        if _line and not _line.startswith("#") and "=" in _line:
            _k, _, _v = _line.partition("=")
            _os.environ.setdefault(_k.strip(), _v.strip())

MISSIONS_ROOT: _Path = _Path(__file__).parent / "missions"
"""Root folder where mission sub-directories are stored."""

# ── Session management ────────────────────────────────────────────────────────
SESSION_TTL_SECONDS: int = 1500
"""How long an upload session is kept alive in memory before being pruned."""

MAX_SESSIONS: int = 50
"""Hard cap on concurrent sessions. Oldest session is evicted when exceeded."""

# ── Smart Lawnmower ──────────────────────────────────────────────────────────
DEFAULT_SMART_FOV_DEG: float = 60.0
"""Default camera horizontal field-of-view (degrees) used by the smart lawnmower."""

DEFAULT_SMART_OVERLAP: float = 0.20
"""Default strip overlap fraction (0–1) for the smart lawnmower."""

SMART_LAWNMOWER_MAX_OVERLAP: float = 0.80
"""Maximum allowed overlap fraction for the smart lawnmower."""

SMART_LAWNMOWER_MIN_SPACING_M: float = 2.0
"""Minimum strip spacing (m) for the smart lawnmower. Computed spacing is clamped to this value."""

# ── Smart Route ───────────────────────────────────────────────────────────────
SMART_ROUTE_CORRIDOR_M: float = 50.0
"""Maximum perpendicular offset (metres) tried when Smart Route lateral optimisation
shifts a transit segment to seek flatter terrain."""

SMART_ROUTE_LATERAL_SAMPLES: int = 11
"""Number of lateral offset values sampled in Smart Route mode, linearly spaced
from -SMART_ROUTE_CORRIDOR_M to +SMART_ROUTE_CORRIDOR_M."""

# ── Safety check ─────────────────────────────────────────────────────────────
BUBBLE_SAMPLE_COUNT: int = 36
"""Number of azimuth samples per ring when checking the horizontal safety bubble."""

BUBBLE_RING_COUNT: int = 3
"""Number of concentric rings sampled inside the safety bubble disc.
Rings are spaced evenly from radius/K to radius. A center-point sample is
always added, giving BUBBLE_RING_COUNT * BUBBLE_SAMPLE_COUNT + 1 terrain
queries per route point."""

# ── AGL profile chart thresholds ──────────────────────────────────────────────
AGL_PROFILE_GOOD_M: float = 15.0
"""AGL clearance above which the profile chart colours a point green."""

AGL_PROFILE_WARN_M: float = 5.0
"""AGL clearance below which the profile chart colours a point red (amber between warn and good)."""

# ── Session management ────────────────────────────────────────────────────────
SESSION_PRUNE_INTERVAL_S: int = 300
"""How often (seconds) the background task sweeps for and removes expired sessions."""

# ── Map tiles ─────────────────────────────────────────────────────────────────
TILE_URL_OFFLINE: str = _os.getenv("TILE_URL_OFFLINE", "")
"""Full tile URL template for offline deployments (e.g. http://192.168.1.100:8888/tiles/{z}/{x}/{y}.png).
Set via TILE_URL_OFFLINE env var. When set, offline mode is active automatically."""

OFFLINE_MAPS: bool = bool(TILE_URL_OFFLINE)
"""True when TILE_URL_OFFLINE is set — derived automatically, no separate flag needed."""

TILE_URL_ONLINE: str = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
"""Tile URL used when OFFLINE_MAPS is False — live OpenStreetMap CDN."""

TILE_ATTRIBUTION: str = "Map data &copy; OpenStreetMap contributors"
"""Attribution string used for both tile sources."""

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

RAMP_SLOPE_TOLERANCE: float = 1.02
"""Multiplier applied to max_climb_slope before raising a slope violation.
A 2% margin absorbs floating-point rounding so near-exact ramps don't warn."""

# ── Terrain leg splitting ──────────────────────────────────────────────────────
SPLIT_MAX_DEPTH: int = 3
"""Maximum recursion depth for the impossible-band leg splitter (Step 2b).
Each level halves the leg; at depth 3 an 80 m leg becomes 10 m half-segments.
Increase for smoother profiles on very rugged terrain at the cost of more waypoints."""

SPLIT_MIN_LEG_M: float = 5.0
"""Minimum leg length (metres) below which Step 2b stops recursing.
Prevents degenerate sub-metre waypoints on cliff-edge or quarry-wall terrain
where terrain variation can never be satisfied regardless of how small the leg is."""


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
    assert SMART_ROUTE_CORRIDOR_M > 0, "SMART_ROUTE_CORRIDOR_M must be positive"
    assert SESSION_TTL_SECONDS > 0, "SESSION_TTL_SECONDS must be positive"


_validate()
