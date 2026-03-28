"""
FlyHigh system tests — algorithm correctness.

Each test exercises the full HTTP stack (upload → plan → parse ZIP + metadata).
Synthetic rasters are used so no real terrain files are needed.
"""

import io
import json
import statistics
import zipfile

from tests.conftest import CENTER_LAT, CENTER_LON, make_request, plan, upload

# ── 1. Full pipeline ──────────────────────────────────────────────────────────


async def test_full_pipeline_returns_valid_zip(client, flat_tiff):
    """
    Upload terrain, plan a simple mission, verify the ZIP contains all expected
    artifacts and waypoints.json has the right schema.
    """
    session_id, _ = await upload(client, ("terrain.tif", flat_tiff))

    resp = await client.post("/plan", json=make_request(session_id))
    assert resp.status_code == 200
    meta = json.loads(resp.headers["X-Plan-Meta"])
    zf = zipfile.ZipFile(io.BytesIO(resp.content))
    waypoints = json.loads(zf.read("waypoints.json"))

    # ZIP must contain all four standard outputs
    assert set(zf.namelist()) >= {
        "waypoints.json",
        "mission_report.html",
        "mission_log.txt",
        "waypoints.kml",
    }

    # Waypoints must be a non-empty list with the expected fields
    assert len(waypoints) > 0
    first = waypoints[0]
    assert {"lat", "lon", "alt_m", "action"}.issubset(first.keys())

    # Meta must have positive mission totals
    assert meta["total_distance_m"] > 0
    assert meta["flight_time_s"] > 0
    assert meta["budget_pct"] > 0


# ── 2. Terrain-following altitude — flat ─────────────────────────────────────


async def test_altitude_follows_flat_terrain(client, flat_tiff):
    """
    On a flat 100 m raster with min_agl=30, every planned waypoint should be
    at approximately 130 m MSL (terrain 100 + AGL floor 30).
    No waypoint should breach the AGL ceiling (100 + 120 = 220 m).
    """
    session_id, _ = await upload(client, ("terrain.tif", flat_tiff))
    _, waypoints = await plan(client, make_request(session_id, min_agl=30, max_agl=120))

    altitudes = [wp["alt_m"] for wp in waypoints]

    # All altitudes should be at or above the AGL floor
    assert all(
        alt >= 125 for alt in altitudes
    ), f"Some waypoints are below terrain + min_agl. Min found: {min(altitudes):.1f} m"
    # None should exceed the AGL ceiling
    assert all(
        alt <= 225 for alt in altitudes
    ), f"Some waypoints exceed terrain + max_agl. Max found: {max(altitudes):.1f} m"
    # On flat terrain the spread should be tight — within 20 m of each other
    assert (
        max(altitudes) - min(altitudes) < 20
    ), f"Altitude spread too wide on flat terrain: {max(altitudes) - min(altitudes):.1f} m"


# ── 3. Terrain-following altitude — ramp ─────────────────────────────────────


async def test_altitude_follows_ramp_terrain(client, ramp_tiff):
    """
    On a ramp raster that rises west→east (100 m → 200 m), waypoints on the
    eastern half of the lawnmower should be measurably higher than on the western half.
    This validates that the altitude optimizer tracks actual terrain gradients.
    """
    # The ramp raster uses a smaller 0.01° span; keep start inside that extent
    session_id, _ = await upload(client, ("terrain.tif", ramp_tiff))
    req = make_request(
        session_id,
        start_lat=CENTER_LAT - 0.004,
        start_lon=CENTER_LON,
        width_m=300,
        height_m=200,
        min_agl=30,
        max_agl=200,
    )
    _, waypoints = await plan(client, req)

    west_alts = [wp["alt_m"] for wp in waypoints if wp["lon"] < CENTER_LON]
    east_alts = [wp["alt_m"] for wp in waypoints if wp["lon"] >= CENTER_LON]

    assert west_alts and east_alts, "Expected waypoints on both sides of the raster centre"

    east_median = statistics.median(east_alts)
    west_median = statistics.median(west_alts)

    assert east_median - west_median > 10, (
        f"East median ({east_median:.1f} m) is not meaningfully higher than "
        f"west median ({west_median:.1f} m). Altitude optimizer may not be "
        f"reading terrain gradients."
    )


# ── 4. Lawnmower coverage stays inside POI bounds ────────────────────────────


async def test_lawnmower_waypoints_stay_inside_poi_bounds(client, flat_tiff):
    """
    All coverage waypoints must fall within (or very close to) the declared
    POI bounding box.  Validates that maneuver geometry is correctly projected.
    """
    import math

    session_id, _ = await upload(client, ("terrain.tif", flat_tiff))
    POI_LAT, POI_LON = CENTER_LAT, CENTER_LON
    HALF_M = 200  # 400 × 400 m POI

    # Convert metres to rough degree offsets at lat 32
    lat_per_m = 1 / 111_320
    lon_per_m = 1 / (111_320 * math.cos(math.radians(POI_LAT)))
    buffer = 0.002  # generous ~220 m buffer for entry/exit manoeuvres

    lat_lo = POI_LAT - HALF_M * lat_per_m - buffer
    lat_hi = POI_LAT + HALF_M * lat_per_m + buffer
    lon_lo = POI_LON - HALF_M * lon_per_m - buffer
    lon_hi = POI_LON + HALF_M * lon_per_m + buffer

    _, waypoints = await plan(
        client,
        make_request(session_id, poi_lat=POI_LAT, poi_lon=POI_LON, width_m=400, height_m=400),
    )

    # Coverage waypoints use the maneuver type as their action label (e.g. "lawnmower")
    coverage = [wp for wp in waypoints if wp["action"] not in ("waypoint", "poi", "land")]
    assert len(coverage) > 0, "No coverage waypoints found"

    out_of_bounds = [
        wp
        for wp in coverage
        if not (lat_lo <= wp["lat"] <= lat_hi and lon_lo <= wp["lon"] <= lon_hi)
    ]
    assert (
        out_of_bounds == []
    ), f"{len(out_of_bounds)} coverage waypoints are outside the expected POI bounding box"


# ── 5. Safety violations on spike terrain ────────────────────────────────────


async def test_safety_violation_on_spike_terrain(client, flat_dtm_tiff, spike_dsm_tiff):
    """
    When the surface model (DSM) contains a 300 m obstacle spike but the bare-ground
    model (DTM) is flat at 50 m, the altitude optimizer plans at ~80 m MSL based on
    the DTM — but the safety checker compares against the DSM and must flag a
    vertical violation at the spike.
    """
    session_id, _ = await upload(
        client,
        ("dtm.tif", flat_dtm_tiff),
        ("dsm.tif", spike_dsm_tiff),
        {"dtm.tif": "DTM", "dsm.tif": "DSM"},  # explicit types
    )

    meta, _ = await plan(
        client,
        make_request(
            session_id,
            poi_lat=CENTER_LAT,
            poi_lon=CENTER_LON,  # centred on the spike
            width_m=300,
            height_m=300,
            min_agl=30,
            max_agl=80,
        ),
    )

    assert len(meta["violations"]) > 0, (
        "Expected at least one safety violation when flying over a 300 m obstacle "
        "at an altitude planned for 50 m flat terrain"
    )
    kinds = {v["kind"] for v in meta["violations"]}
    assert "vertical" in kinds, f"Expected a vertical violation; got kinds: {kinds}"


# ── 6. POI outside raster — graceful degradation ─────────────────────────────


async def test_poi_outside_raster_degrades_gracefully(client, flat_tiff):
    """
    A POI placed far outside the terrain raster must not crash the planner.
    The response must be HTTP 200 with a coverage_violation explaining the issue.
    """
    session_id, _ = await upload(client, ("terrain.tif", flat_tiff))

    resp = await client.post(
        "/plan",
        # lat=37.0 is in UTM zone 36S (same zone as the session) but ~4.5° from the
        # raster centre — well outside the 0.05° raster extent
        json=make_request(session_id, poi_lat=37.0, poi_lon=34.8),
    )
    assert (
        resp.status_code == 200
    ), f"Planner crashed instead of degrading gracefully: {resp.text[:300]}"

    meta = json.loads(resp.headers["X-Plan-Meta"])
    # Outside-raster terrain falls back to a fixed altitude, causing AGL clearance
    # violations — the planner must surface the problem, not silently succeed.
    assert bool(meta.get("violations")), (
        "Expected violations when POI is outside the raster; "
        f"got violations={meta.get('violations')}"
    )


# ── 7. Battery overrun — plan always delivered ───────────────────────────────


async def test_battery_overrun_still_returns_plan(client, flat_tiff):
    """
    Even when the mission exceeds 100 % battery, the planner must return a
    complete ZIP with budget_pct > 100 in the metadata.
    Battery exhaustion is a warning, never a blocker.
    """
    session_id, _ = await upload(client, ("terrain.tif", flat_tiff))
    meta, waypoints = await plan(
        client,
        make_request(session_id, width_m=3000, height_m=3000, battery_wh=5),
    )

    assert meta["budget_pct"] > 100, (
        f"Expected budget_pct > 100 for a huge mission with a 5 Wh battery, "
        f"got {meta['budget_pct']:.1f} %"
    )
    assert len(waypoints) > 0, "Plan should still contain waypoints despite battery overrun"


# ── 8. Greedy POI reorder reduces transit distance ───────────────────────────


async def test_greedy_poi_reorder_reduces_distance(client, flat_tiff):
    """
    Three POIs arranged so the naive order (far → near → middle) has long backtracking.
    With optimize_poi_order=True the planner reorders them greedily, producing a
    shorter or equal total mission distance.
    """
    session_id, _ = await upload(client, ("terrain.tif", flat_tiff))

    # POI order is deliberately suboptimal: far from start first, then backtrack.
    # All coordinates stay in UTM zone 36S (lat 32–40 °N).
    pois_naive = [
        {"lat": 32.52, "lon": 34.820, "w": 100, "h": 100},  # far northeast
        {"lat": 32.48, "lon": 34.782, "w": 100, "h": 100},  # near start (southwest)
        {"lat": 32.51, "lon": 34.802, "w": 100, "h": 100},  # centre-north
    ]

    meta_naive, _ = await plan(
        client,
        make_request(
            session_id,
            start_lat=32.478,
            start_lon=34.778,
            pois=pois_naive,
            optimize_order=False,
        ),
    )
    meta_optimized, _ = await plan(
        client,
        make_request(
            session_id,
            start_lat=32.478,
            start_lon=34.778,
            pois=pois_naive,
            optimize_order=True,
        ),
    )

    assert meta_optimized["total_distance_m"] <= meta_naive["total_distance_m"], (
        f"Optimized route ({meta_optimized['total_distance_m']:.0f} m) is longer than "
        f"naive route ({meta_naive['total_distance_m']:.0f} m)"
    )


# ── 9. Altitude step smoothing reduces staircase ─────────────────────────────


async def test_min_altitude_step_reduces_staircase(client, ramp_tiff):
    """
    On a ramp terrain, planning with a large min_altitude_step_m (10 m) should
    produce fewer distinct altitude levels than planning with no smoothing (0 m).
    Validates the causal forward-pass staircase suppression in altitude.py.
    """
    session_id, _ = await upload(client, ("terrain.tif", ramp_tiff))

    base_req = dict(
        start_lat=CENTER_LAT - 0.004,
        start_lon=CENTER_LON,
        width_m=300,
        height_m=200,
        min_agl=30,
        max_agl=200,
    )

    _, wps_no_smooth = await plan(client, make_request(session_id, min_step_m=0, **base_req))
    _, wps_smoothed = await plan(client, make_request(session_id, min_step_m=10, **base_req))

    # Count distinct altitude levels (rounded to 1 decimal to ignore float noise)
    distinct_no_smooth = len({round(wp["alt_m"], 1) for wp in wps_no_smooth})
    distinct_smoothed = len({round(wp["alt_m"], 1) for wp in wps_smoothed})

    assert distinct_smoothed < distinct_no_smooth, (
        f"Smoothed plan ({distinct_smoothed} distinct altitudes) should have fewer "
        f"levels than unsmoothed ({distinct_no_smooth})"
    )
