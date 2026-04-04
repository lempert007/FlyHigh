"""
Unit tests for the Smart Lawnmower geometry functions and preview endpoint.
"""

import math
import sys
from pathlib import Path

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

sys.path.insert(0, str(Path(__file__).parent.parent))

import config
from core.poi import (
    compute_overlap_spacing,
    compute_precise_spacing,
    generate_smart_lawnmower_pattern,
)
from core.route import LatLon
from main import app

# ── Pure geometry ─────────────────────────────────────────────────────────────


class TestComputePreciseSpacing:
    def test_basic(self):
        # At 60° FOV and 50 m AGL, precise_spacing = 2 * 50 * tan(30°)
        expected = 2.0 * 50.0 * math.tan(math.radians(30.0))
        assert abs(compute_precise_spacing(50.0, 60.0) - expected) < 1e-9

    def test_wider_fov_gives_wider_precise_spacing(self):
        h = 40.0
        assert compute_precise_spacing(h, 90.0) > compute_precise_spacing(h, 60.0)

    def test_higher_altitude_gives_wider_precise_spacing(self):
        fov = 60.0
        assert compute_precise_spacing(60.0, fov) > compute_precise_spacing(30.0, fov)

    def test_invalid_altitude_raises(self):
        with pytest.raises(ValueError):
            compute_precise_spacing(0.0, 60.0)

    def test_invalid_fov_raises(self):
        with pytest.raises(ValueError):
            compute_precise_spacing(30.0, 0.0)
        with pytest.raises(ValueError):
            compute_precise_spacing(30.0, 180.0)


class TestComputeOverlapSpacing:
    def test_zero_overlap_equals_precise_spacing(self):
        assert abs(compute_overlap_spacing(50.0, 0.0) - 50.0) < 1e-9

    def test_50_percent_overlap_gives_half_precise_spacing(self):
        assert abs(compute_overlap_spacing(50.0, 0.5) - 25.0) < 1e-9

    def test_more_overlap_gives_less_overlap_spacing(self):
        assert compute_overlap_spacing(50.0, 0.3) > compute_overlap_spacing(50.0, 0.6)

    def test_invalid_overlap_raises(self):
        with pytest.raises(ValueError):
            compute_overlap_spacing(50.0, -0.1)
        with pytest.raises(ValueError):
            compute_overlap_spacing(50.0, 1.0)


class TestGenerateSmartLawnmowerPattern:
    def test_returns_nonempty(self):
        center = LatLon(lat=32.0, lon=34.8)
        pts = generate_smart_lawnmower_pattern(center, 200.0, 200.0, 50.0, 60.0, 0.2)
        assert len(pts) > 0

    def test_more_overlap_more_strips(self):
        """Higher overlap → denser strips → more waypoints."""
        center = LatLon(lat=32.0, lon=34.8)
        pts_low = generate_smart_lawnmower_pattern(center, 200.0, 200.0, 50.0, 60.0, 0.1)
        pts_high = generate_smart_lawnmower_pattern(center, 200.0, 200.0, 50.0, 60.0, 0.6)
        assert len(pts_high) > len(pts_low)

    def test_narrower_fov_more_strips(self):
        """Narrower FOV → smaller footprint → tighter strips → more waypoints."""
        center = LatLon(lat=32.0, lon=34.8)
        pts_wide = generate_smart_lawnmower_pattern(center, 200.0, 200.0, 50.0, 90.0, 0.2)
        pts_narrow = generate_smart_lawnmower_pattern(center, 200.0, 200.0, 50.0, 30.0, 0.2)
        assert len(pts_narrow) > len(pts_wide)

    def test_spacing_clamped_to_minimum(self):
        """Very high altitude + wide FOV + zero overlap should not produce spacing < min."""
        center = LatLon(lat=32.0, lon=34.8)
        # This should clamp without raising
        pts = generate_smart_lawnmower_pattern(center, 50.0, 50.0, 1000.0, 170.0, 0.0)
        assert len(pts) > 0


# ── Preview endpoint ──────────────────────────────────────────────────────────


@pytest_asyncio.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest.mark.asyncio
async def test_preview_basic(client):
    resp = await client.get(
        "/preview-strip-spacing", params={"alt_agl": 50, "fov_deg": 60, "overlap": 0.2}
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["precise_spacing_m"] > 0
    assert data["overlap_spacing_m"] > 0
    assert data["estimated_strips"] is None
    assert data["warning"] is None


@pytest.mark.asyncio
async def test_preview_with_area_width(client):
    resp = await client.get(
        "/preview-strip-spacing",
        params={"alt_agl": 50, "fov_deg": 60, "overlap": 0.2, "area_width_m": 200},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["estimated_strips"] is not None
    assert data["estimated_strips"] >= 1


@pytest.mark.asyncio
async def test_preview_overlap_too_high(client):
    resp = await client.get(
        "/preview-strip-spacing",
        params={"alt_agl": 50, "fov_deg": 60, "overlap": config.SMART_LAWNMOWER_MAX_OVERLAP},
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_preview_clamped_warns(client):
    """Very low alt + narrow FOV → tiny footprint → raw spacing below minimum → clamped."""
    # At h=1m, fov=5°: footprint ≈ 0.087 m → spacing well below 2 m min
    resp = await client.get(
        "/preview-strip-spacing",
        params={"alt_agl": 1, "fov_deg": 5, "overlap": 0.0},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["overlap_spacing_m"] == config.SMART_LAWNMOWER_MIN_SPACING_M
    assert data["warning"] is not None


@pytest.mark.asyncio
async def test_preview_invalid_fov(client):
    resp = await client.get(
        "/preview-strip-spacing", params={"alt_agl": 50, "fov_deg": 0, "overlap": 0.2}
    )
    assert resp.status_code == 422
