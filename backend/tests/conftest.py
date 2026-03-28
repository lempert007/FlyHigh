"""
Shared fixtures and helpers for FlyHigh system tests.

Rasters are generated in-memory with rasterio + numpy — no real terrain files needed.
All rasters are 64×64 pixels, WGS-84 EPSG:4326, centred at lat=32.0 lon=34.8.
"""

import io
import json
import sys
import zipfile
from pathlib import Path

import numpy as np
import pytest
import pytest_asyncio
import rasterio
from httpx import ASGITransport, AsyncClient
from rasterio.crs import CRS
from rasterio.transform import from_bounds

# Make the backend package importable from the tests subdirectory
sys.path.insert(0, str(Path(__file__).parent.parent))
from main import app  # noqa: E402

# ── Raster geography ─────────────────────────────────────────────────────────

CENTER_LAT = 32.5   # clearly inside UTM zone 36S (32–40 °N), avoiding the 32° band boundary
CENTER_LON = 34.8
SPAN       = 0.05   # degrees — ~5.5 km × ~4.4 km at lat 32


def _make_tiff(data: np.ndarray, span: float = SPAN) -> bytes:
    """Encode a 2-D numpy array as a single-band float32 GeoTIFF bytes."""
    H, W = data.shape
    west,  east  = CENTER_LON - span / 2, CENTER_LON + span / 2
    south, north = CENTER_LAT - span / 2, CENTER_LAT + span / 2
    transform = from_bounds(west, south, east, north, W, H)
    buf = io.BytesIO()
    with rasterio.open(
        buf, "w",
        driver="GTiff", height=H, width=W, count=1,
        dtype="float32", crs=CRS.from_epsg(4326), transform=transform,
    ) as ds:
        ds.write(data.astype("float32"), 1)
    return buf.getvalue()


# ── Terrain fixtures (session-scoped — built once per test run) ───────────────

@pytest.fixture(scope="session")
def flat_tiff() -> bytes:
    """Flat terrain at 100 m elevation."""
    return _make_tiff(np.full((64, 64), 100.0))


@pytest.fixture(scope="session")
def ramp_tiff() -> bytes:
    """
    Terrain that rises west→east: 100 m at the west edge, 200 m at the east edge.
    Uses a smaller 0.01° span so a 300 m POI covers a meaningful elevation gradient
    (~27 m rise across a 300 m lawnmower).
    """
    return _make_tiff(
        np.tile(np.linspace(100, 200, 64), (64, 1)),
        span=0.01,
    )


@pytest.fixture(scope="session")
def flat_dtm_tiff() -> bytes:
    """Bare-ground (DTM) — flat at 50 m, used together with spike_dsm_tiff."""
    return _make_tiff(np.full((64, 64), 50.0))


@pytest.fixture(scope="session")
def spike_dsm_tiff() -> bytes:
    """
    Surface model (DSM) — flat at 50 m with a 300 m obstacle spike in the centre
    (pixels [28:36, 28:36]).  When paired with flat_dtm_tiff the planner uses the
    DTM to set altitude (~80 m MSL) but the safety checker sees the 300 m DSM spike
    and flags a vertical violation.
    """
    data = np.full((64, 64), 50.0)
    data[28:36, 28:36] = 300.0
    return _make_tiff(data)


# ── HTTP client fixture ───────────────────────────────────────────────────────

@pytest_asyncio.fixture
async def client():
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c


# ── Helpers (plain functions, not fixtures) ───────────────────────────────────

async def upload(client, *tiffs: tuple[str, bytes]) -> tuple[str, list[str]]:
    """
    Upload one or more (filename, bytes) pairs.  Returns (session_id, [filenames]).
    file_types defaults to empty — the backend infers DSM/DTM from the filename.
    Pass explicit file_types as the last positional arg if needed.
    """
    file_types: dict[str, str] = {}
    # Allow caller to pass file_types as a trailing dict
    real_tiffs = []
    for item in tiffs:
        if isinstance(item, dict):
            file_types = item
        else:
            real_tiffs.append(item)

    files = [("files", (name, data, "image/tiff")) for name, data in real_tiffs]
    resp = await client.post(
        "/upload",
        files=files,
        data={"file_types": json.dumps(file_types)},
    )
    assert resp.status_code == 200, f"Upload failed: {resp.text}"
    data = resp.json()
    return data["session_id"], [f["name"] for f in data["files"]]


def make_request(
    session_id: str,
    *,
    poi_lat: float = CENTER_LAT,
    poi_lon: float = CENTER_LON,
    start_lat: float = CENTER_LAT - 0.001,
    start_lon: float = CENTER_LON - 0.003,
    pois: list[dict] | None = None,
    width_m: float = 200,
    height_m: float = 200,
    battery_wh: float = 120,
    min_agl: float = 30,
    max_agl: float = 120,
    optimize_order: bool = False,
    min_step_m: float = 2.0,
) -> dict:
    """Build a RouteRequest dict.  Use *pois* to specify multiple POIs directly."""
    if pois is None:
        pois = [{"lat": poi_lat, "lon": poi_lon, "w": width_m, "h": height_m}]

    return {
        "session_id": session_id,
        "name": "test_mission",
        "notes": "",
        "start":   {"lat": start_lat, "lon": start_lon},
        "landing": {"lat": start_lat, "lon": start_lon},
        "waypoints": [],
        "pois": [
            {
                "point": {"lat": p["lat"], "lon": p["lon"]},
                "maneuver": {
                    "type": "lawnmower",
                    "width_m":  p.get("w", width_m),
                    "height_m": p.get("h", height_m),
                    "sweep_spacing_m": 30,
                    "poi_min_agl_m": None,
                    "poi_max_agl_m": None,
                },
            }
            for p in pois
        ],
        "config": {
            "min_agl_m": min_agl,
            "max_agl_m": max_agl,
            "cruise_speed_ms": 10,
            "climb_rate_ms":   5,
            "battery_wh":      battery_wh,
            "drone_weight_kg": 0.5,
            "spacing_m":       20,
            "point_radius_m":  5,
            "smart_route":        False,
            "optimize_poi_order": optimize_order,
            "min_altitude_step_m": min_step_m,
        },
    }


async def plan(client, request: dict) -> tuple[dict, list[dict]]:
    """
    POST /plan, assert 200, return (meta_dict, waypoints_list).
    meta comes from the X-Plan-Meta header; waypoints from the ZIP.
    """
    resp = await client.post("/plan", json=request)
    assert resp.status_code == 200, f"Plan failed: {resp.text[:500]}"

    meta = json.loads(resp.headers["X-Plan-Meta"])

    zf = zipfile.ZipFile(io.BytesIO(resp.content))
    waypoints = json.loads(zf.read("waypoints.json"))

    return meta, waypoints
