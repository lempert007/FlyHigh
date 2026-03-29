"""
POST /plan — compute a terrain-following flight route and return a ZIP download.

This module is a thin adapter:
  1. Load session → extract rasterio datasets.
  2. Build TerrainIndex objects for DSM and DTM.
  3. Build FlightParams + MissionInput.
  4. Call route.plan_route().
  5. Map MissionResult → API contract (ViolationInfo, PlanMeta).
  6. Render outputs and package ZIP.
"""

from __future__ import annotations

import asyncio
import contextvars
import hashlib
import io
import json
import logging
import re
from datetime import UTC, date, datetime
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    import rasterio

import numpy as np
import utm as _utm_lib
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response, StreamingResponse
from scipy.spatial import KDTree

import config
import session as session_store
from core.battery import estimate_flight
from core.poi import (
    build_poi_zone,
    compute_entry_bearing,
    generate_lawnmower_pattern,
    generate_lawnmower_polygon_pattern,
    generate_warp_and_weft_pattern,
)
from core.route import (
    compute_cumulative_distances,
    compute_headings,
    detect_mission_zone,
    plan_route,
)
from core.safety import compute_profile_bands
from core.terrain import TerrainIndex, build_terrain_index
from core.types import (
    AltitudeBand,
    FlightParams,
    LatLon,
    MissionInput,
    PoiZone,
    Violation,
    ViolationTier,
)
from core.utm_utils import haversine_m, utm_to_latlon
from session import LastPlanData, store_plan_data

# Actions that indicate a dense waypoint is inside a POI scan area
_POI_ACTIONS = frozenset({"poi", "lawnmower", "warp_weft"})
from api.settings import load_settings
from export.mission_log import generate_mission_log
from export.packager import build_zip, strip_internal_files
from export.render_3d import render_3d_html
from export.render_combined import render_combined_html
from export.render_kml import render_kml
from export.render_map import render_map_html
from export.render_profile import render_profile_html
from export.render_smart_route_diff import render_smart_route_diff_html
from export.waypoints import serialise_waypoints_json, to_waypoints_json
from models import PlanMeta, POIConfig, RouteRequest, ViolationInfo

logger = logging.getLogger(__name__)

router = APIRouter()

# ── SSE progress streaming ─────────────────────────────────────────────────────

# Per-request context: (queue, event_loop) written by the async endpoint,
# read by _ProgressHandler running inside the thread-pool worker.
_progress_ctx_var: contextvars.ContextVar[
    tuple["asyncio.Queue[dict | None]", asyncio.AbstractEventLoop] | None
] = contextvars.ContextVar("_progress_ctx_var", default=None)

# Phase name for each PLAN_STEPS index (must mirror usePlanRoute.ts PLAN_STEPS)
_STEP_PHASES = [
    "terrain", "terrain", "terrain",
    "route", "route", "route", "route",
    "altitude", "altitude", "altitude", "altitude", "altitude",
    "altitude", "altitude", "altitude",
    "safety", "safety", "safety",
    "packaging", "packaging", "packaging", "packaging",
]

# Maps (logger-name-suffix, message-prefix) → PLAN_STEPS index
_STEP_MAP: list[tuple[str, str, int]] = [
    ("plan",     "Opening raster",           0),
    ("terrain",  "Reprojecting CRS",          1),
    ("terrain",  "Building terrain",         2),
    ("plan",     "Tracing transit legs",     3),
    ("plan",     "Generating maneuver",      4),
    ("altitude", "Step 2a",                  5),
    ("altitude", "Step 2b",                  6),
    ("altitude", "Step 3",                   7),
    ("altitude", "Step 4a",                  8),
    ("altitude", "Step 4b",                  9),
    ("altitude", "Step 4c",                 10),
    ("altitude", "Step 4d",                 11),
    ("altitude", "Step 5",                  12),
    ("altitude", "Step 7",                  13),
    ("altitude", "Step 8",                  14),
    ("safety",   "Checking vertical",       15),
    ("safety",   "Verifying safety bubble", 16),
    ("safety",   "Checking camera",         17),
    ("route",    "Densifying",              18),
    ("plan",     "Writing waypoints",       19),
    ("plan",     "Generating mission_log",  20),
    ("plan",     "Assembling ZIP",          21),
]


class _ProgressHandler(logging.Handler):
    """Routes matching log records to the per-request SSE queue (no-op outside plan requests)."""

    def emit(self, record: logging.LogRecord) -> None:
        ctx = _progress_ctx_var.get(None)
        if ctx is None:
            return
        suffix = record.name.split(".")[-1]
        msg = record.getMessage()
        for name_suffix, prefix, step_idx in _STEP_MAP:
            if suffix == name_suffix and msg.startswith(prefix):
                queue, loop = ctx
                event = {"step": step_idx, "phase": _STEP_PHASES[step_idx], "msg": msg}
                loop.call_soon_threadsafe(queue.put_nowait, event)
                return


# Installed once at import time — no-ops unless a plan request is active.
logging.getLogger().addHandler(_ProgressHandler())


def _zip_filename(mission_name: str) -> str:
    slug = re.sub(r"[^\w\-]", "_", (mission_name or "mission").strip())[:40].strip("_") or "mission"
    return f"{slug}_{date.today().strftime('%Y%m%d')}.zip"


def _post_progress_sentinel() -> None:
    """Post the None sentinel to the SSE queue so the async generator can stop."""
    ctx = _progress_ctx_var.get(None)
    if ctx is not None:
        queue, loop = ctx
        loop.call_soon_threadsafe(queue.put_nowait, None)


def _post_step(step_idx: int) -> None:
    """Post a progress step event to the SSE queue directly from the planning thread."""
    ctx = _progress_ctx_var.get(None)
    if ctx is None:
        return
    queue, loop = ctx
    event = {"step": step_idx, "phase": _STEP_PHASES[step_idx]}
    loop.call_soon_threadsafe(queue.put_nowait, event)


def _run_planning_sync(req: RouteRequest) -> tuple[bytes, "PlanMeta"]:
    """Synchronous planning worker — runs in a thread pool via run_in_executor.

    Returns (user_zip_bytes, meta). Always posts a None sentinel to the SSE queue
    so the async generator knows when to stop waiting.
    """
    logger.info(
        "Planning route: %d POIs, %d waypoints, smart_route=%s",
        len(req.pois),
        len(req.waypoints),
        req.config.smart_route,
    )

    # ── 1. Load session ────────────────────────────────────────────────────────
    sess = session_store.get_session(req.session_id)
    if sess is None:
        _post_progress_sentinel()
        raise HTTPException(
            status_code=404, detail=f"Session {req.session_id!r} not found or expired"
        )
    if not sess.files:
        _post_progress_sentinel()
        raise HTTPException(status_code=400, detail="Session contains no uploaded terrain files")

    datasets = {name: sf.dataset for name, sf in sess.files.items()}
    file_infos = {name: sf.info for name, sf in sess.files.items()}

    try:
        # ── 2. Resolve DSM / DTM datasets ─────────────────────────────────────
        dsm_ds, dtm_ds = _resolve_dsm_dtm(datasets, file_infos)

        terrain_resolution_m: float | None = None
        for _fname, _fi in file_infos.items():
            if datasets[_fname] is dsm_ds:
                terrain_resolution_m = round(_fi.resolution_m, 1)
                break

        # ── 3. Build TerrainIndex objects ─────────────────────────────────────
        _post_step(0)   # "Opening raster tiles from session store"
        dsm_index = build_terrain_index(
            dsm_ds,
            on_reproject=lambda: _post_step(1),
            on_interpolate=lambda: _post_step(2),
        )
        dtm_index = (
            build_terrain_index(dtm_ds, on_reproject=lambda: _post_step(1), on_interpolate=lambda: _post_step(2))
            if dtm_ds is not dsm_ds
            else dsm_index
        )

        zone_str = dtm_index.zone_str

        # ── 4. Validate mission zone ───────────────────────────────────────────
        all_latlon_points = (
            [req.start] + req.waypoints + [poi.point for poi in req.pois] + [req.landing]
        )
        try:
            detect_mission_zone(all_latlon_points)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

        # ── 5. Build FlightParams ──────────────────────────────────────────────
        fc = req.config
        params = FlightParams(
            min_agl_m=fc.min_agl_m,
            max_agl_m=fc.max_agl_m,
            cruise_speed_ms=fc.cruise_speed_ms,
            climb_rate_ms=fc.climb_rate_ms,
            spacing_m=fc.spacing_m,
            battery_wh=fc.battery_wh,
            drone_weight_kg=fc.drone_weight_kg,
            point_radius_m=fc.point_radius_m,
            max_surface_radius_m=fc.max_surface_radius_m,
            takeoff_alt_msl=req.takeoff_alt_m,
            optimize_poi_order=fc.optimize_poi_order,
            smart_route_corridor_m=fc.smart_route_corridor_m if fc.smart_route else None,
            min_step_m=fc.min_altitude_step_m,
            max_slope_ratio=fc.max_slope_ratio,
        )
        global_band = AltitudeBand(min_agl_m=params.min_agl_m, max_agl_m=params.max_agl_m)

        # ── 6. Resolve POI order ───────────────────────────────────────────────
        logger.info("Tracing transit legs between waypoints: %d waypoints", len(req.waypoints))
        if fc.optimize_poi_order and len(req.pois) > 2:
            pois_to_plan = _reorder_pois_tsp(req.pois, req.start.lat, req.start.lon)
            logger.info("POI order optimised (nearest-neighbor TSP)")
        else:
            pois_to_plan = req.pois

        # ── 7. Build PoiZones and 2-D patterns ───────────────────────────────
        poi_zones: list[PoiZone] = []
        poi_patterns: list[list[LatLon]] = []
        poi_maneuver_radii: list[float] = []
        total_covered_area_m2: float = 0.0

        prev_point = LatLon(lat=req.start.lat, lon=req.start.lon)

        for poi_idx, poi in enumerate(pois_to_plan):
            poi_center = LatLon(lat=poi.point.lat, lon=poi.point.lon)
            entry_bearing = compute_entry_bearing(prev_point, poi_center)
            zone = build_poi_zone(poi, global_band, zone_str, poi_idx, entry_bearing_deg=entry_bearing)
            poi_zones.append(zone)
            pattern = _expand_maneuver_latlon(
                poi,
                zone_str,
                entry_bearing,
                dtm_index,
                params,
                prev_point=prev_point,
            )
            if not pattern:
                logger.warning(
                    "POI %d generated 0 waypoints — polygon may be too small for sweep spacing",
                    poi_idx,
                )
            poi_patterns.append(pattern)

            # Approximate covered area
            if pattern:
                spacing = poi.maneuver.sweep_spacing_m
                total_covered_area_m2 += len(pattern) * spacing * fc.spacing_m

            poi_maneuver_radii.append(max(poi.maneuver.width_m, poi.maneuver.height_m) / 2.0)

            # Update previous point for next iteration's bearing
            if pattern:
                prev_point = pattern[-1]
            else:
                prev_point = poi_center

        logger.info("Generating maneuver sweeps for %d POIs", len(pois_to_plan))

        # ── 8. Assemble MissionInput and call plan_route ───────────────────────
        bubble_terrain = _pick_terrain(fc.safety_radius_terrain, dsm_index, dtm_index)
        camera_terrain = _pick_terrain(fc.camera_range_terrain, dsm_index, dtm_index)
        mission = MissionInput(
            dsm=dsm_index,
            dtm=dtm_index,
            start=LatLon(lat=req.start.lat, lon=req.start.lon),
            waypoints=[LatLon(lat=w.lat, lon=w.lon) for w in req.waypoints],
            poi_zones=poi_zones,
            poi_2d_waypoints=poi_patterns,
            landing=LatLon(lat=req.landing.lat, lon=req.landing.lon),
            params=params,
            bubble_terrain=bubble_terrain,
            camera_terrain=camera_terrain,
        )
        result = plan_route(mission)

        # ── 9. Extract numpy arrays from MissionResult ────────────────────────
        dense_wps = result.waypoints_3d
        n_dense = len(dense_wps)

        dense_utm = result.dense_utm
        final_alts = np.array([w.alt_msl for w in dense_wps])
        dense_actions = [w.action for w in dense_wps]

        # Sample terrain from DTM for profile chart
        terrain_elevs = dtm_index.sample_points(dense_utm)
        nan_mask = np.isnan(terrain_elevs)
        if nan_mask.all():
            raise HTTPException(
                status_code=422,
                detail="Terrain raster contains no valid elevation data — check that the uploaded file covers the mission area.",
            )
        if nan_mask.any():
            valid = terrain_elevs[~nan_mask]
            safe_fill = float(valid.max()) + fc.max_agl_m
            terrain_elevs = np.where(nan_mask, safe_fill, terrain_elevs)

        # AGL clearance profile — one value per dense waypoint
        agl_arr = final_alts - terrain_elevs
        agl_arr_profile = np.where(nan_mask, 999.0, agl_arr)
        agl_profile_json_str = json.dumps([round(float(v), 1) for v in agl_arr_profile.tolist()])

        # Clearance statistics (valid terrain points only)
        valid_agl = agl_arr[~nan_mask]
        if len(valid_agl) > 0:
            min_clearance_m: float | None = round(float(np.min(valid_agl)), 1)
            mean_clearance_m: float | None = round(float(np.mean(valid_agl)), 1)
            tight_segment_count: int | None = int(np.sum(valid_agl < fc.min_agl_m * 1.2))
        else:
            min_clearance_m = mean_clearance_m = None
            tight_segment_count = None

        cum_dists = compute_cumulative_distances(dense_utm)
        total_dist_m = float(cum_dists[-1]) if len(cum_dists) > 0 else 0.0

        # ── 10. Map violations to ViolationInfo ────────────────────────────────
        # Build KDTree for nearest-point lookup
        if n_dense > 0:
            kd_tree = KDTree(dense_utm)
        else:
            kd_tree = None

        violations_info: list[ViolationInfo] = []
        if result.violations:
            if kd_tree is not None:
                # Batch-convert all violation locations in one vectorized pass
                viol_locs = np.array(
                    [
                        _utm_lib.from_latlon(v.location.lat, v.location.lon)[:2]
                        for v in result.violations
                    ]
                )
                _, nearest_indices = kd_tree.query(viol_locs)
                point_indices = nearest_indices.tolist()
            else:
                point_indices = [0] * len(result.violations)
            for v, pidx in zip(result.violations, point_indices):
                if v.tier == ViolationTier.HARD:
                    category = "safety"
                elif dense_actions[pidx] in _POI_ACTIONS:
                    category = "product_poi"
                else:
                    category = "product_route"
                violations_info.append(_violation_to_info(v, int(pidx), category))

        # ── 10b. POI scan quality metric ───────────────────────────────────────
        poi_mask = np.array([a in _POI_ACTIONS for a in dense_actions])
        valid_poi = poi_mask & ~nan_mask
        poi_total = int(valid_poi.sum())
        if poi_total > 0:
            poi_violated = int((agl_arr[valid_poi] > fc.max_agl_m).sum())
            poi_scan_good_pct: float | None = round((1 - poi_violated / poi_total) * 100, 1)
        else:
            poi_scan_good_pct = None

        # ── 11. Build plan metadata ────────────────────────────────────────────
        energy_wh = result.energy_wh
        flight_time_s = result.flight_time_s
        budget_pct = result.budget_pct

        warning: str | None = None
        error: str | None = None
        _app_settings = load_settings()
        if budget_pct > _app_settings.battery_error_pct:
            error = f"Battery usage {budget_pct:.0f}% exceeds capacity - route returned but may not complete."
        elif budget_pct > _app_settings.battery_warning_pct:
            warning = f"Battery usage {budget_pct:.0f}% is near capacity."
        if terrain_resolution_m is not None and terrain_resolution_m > 20.0:
            res_warn = f"Terrain resolution is coarse ({terrain_resolution_m:.0f} m/px) - altitude clearances may be less accurate."
            warning = f"{res_warn} {warning}" if warning else res_warn

        meta = PlanMeta(
            total_distance_m=round(total_dist_m, 1),
            flight_time_s=round(flight_time_s, 1),
            energy_wh=round(energy_wh, 2),
            budget_pct=round(budget_pct, 1),
            violations=violations_info,
            warning=warning,
            error=error,
            smart_route_summary=result.smart_route_summary,
            terrain_resolution_m=terrain_resolution_m,
            covered_area_m2=round(total_covered_area_m2, 1) if total_covered_area_m2 > 0 else None,
            min_clearance_m=min_clearance_m,
            mean_clearance_m=mean_clearance_m,
            tight_segment_count=tight_segment_count,
            min_agl_m=fc.min_agl_m,
            max_agl_m=fc.max_agl_m,
            poi_scan_good_pct=poi_scan_good_pct,
        )

        # ── 12. Find index arrays for render functions ─────────────────────────
        # First occurrence of each contiguous "waypoint" block (not every dense point)
        waypoint_indices = _find_waypoint_block_starts(dense_actions)
        # First occurrence of each "poi" block
        poi_indices = _find_poi_block_starts(dense_actions)
        # Landing index
        landing_index = next(
            (i for i in range(n_dense - 1, -1, -1) if dense_actions[i] == "land"),
            n_dense - 1,
        )

        # ── 13. Headings ──────────────────────────────────────────────────────
        headings = compute_headings(dense_utm)

        # ── 14. Waypoints JSON ────────────────────────────────────────────────
        logger.info("Writing waypoints.json: %d dense waypoints", n_dense)
        waypoints_json = to_waypoints_json(
            dense_utm,
            final_alts,
            headings,
            zone_str,
            speed_ms=fc.cruise_speed_ms,
            actions=dense_actions,
        )
        wp_json_str = serialise_waypoints_json(waypoints_json)

        # ── 15. POI start distances + end indices ─────────────────────────────
        # Profile chart marks the START of each POI maneuver block.
        poi_distances = [float(cum_dists[i]) for i in poi_indices] if poi_indices else []

        # Compute the end index of each POI maneuver block (used for RTH + band overrides).
        poi_end_indices = _find_poi_end_indices(poi_indices or [], dense_actions, n_dense)

        # ── 16. Per-POI band overrides for profile chart ──────────────────────
        poi_band_overrides: list[tuple[float, float, float, float]] = []
        for poi_idx_in_list, poi in enumerate(pois_to_plan):
            m = poi.maneuver
            if m.poi_min_agl_m is None and m.poi_max_agl_m is None:
                continue
            poi_min = m.poi_min_agl_m if m.poi_min_agl_m is not None else fc.min_agl_m
            poi_max = m.poi_max_agl_m if m.poi_max_agl_m is not None else fc.max_agl_m
            if poi_idx_in_list < len(poi_indices) and poi_idx_in_list < len(poi_end_indices):
                start_d = float(cum_dists[poi_indices[poi_idx_in_list]])
                end_d = float(cum_dists[min(poi_end_indices[poi_idx_in_list], n_dense - 1)])
                poi_band_overrides.append((start_d, end_d, poi_min, poi_max))

        # ── 17. Render map ─────────────────────────────────────────────────────
        map_html = render_map_html(
            dense_utm,
            final_alts,
            zone_str,
            fc,
            start_index=0,
            waypoint_indices=waypoint_indices,
            poi_indices=poi_indices,
            poi_maneuver_radii=poi_maneuver_radii,
            violations=[(v.point_index, v.description, v.category) for v in violations_info],
            landing_index=landing_index,
        )

        # ── 18. Render 3-D view ────────────────────────────────────────────────
        chart_3d = render_3d_html(
            dense_utm,
            final_alts,
            dsm_index,
            zone_str,
            poi_indices=poi_indices,
        )

        # ── 19. Return-to-home distance ────────────────────────────────────────
        # RTH starts the moment the last POI maneuver ends.
        return_home_dist = (
            float(cum_dists[poi_end_indices[-1]])
            if poi_end_indices
            else float(cum_dists[landing_index])
            if landing_index < n_dense
            else total_dist_m
        )

        # ── 20. Cumulative energy for profile ─────────────────────────────────
        cum_energy = estimate_flight(dense_utm, final_alts, params).cumulative_wh

        bubble_peak_terrain, camera_min_terrain = compute_profile_bands(
            dense_utm, terrain_elevs, bubble_terrain, camera_terrain, params
        )

        poi_scan_areas = [
            (float(cum_dists[s]), float(cum_dists[min(e, n_dense - 1)]))
            for s, e in zip(poi_indices or [], poi_end_indices or [])
        ]

        profile_html = render_profile_html(
            dense_utm,
            final_alts,
            terrain_elevs,
            cum_dists,
            fc,
            poi_distances=poi_distances or None,
            return_home_distance=return_home_dist,
            poi_band_overrides=poi_band_overrides or None,
            poi_scan_areas=poi_scan_areas or None,
            cumulative_energy_wh=cum_energy,
            violation_points=[(v.point_index, v.category) for v in violations_info] or None,
            bubble_peak_terrain=bubble_peak_terrain,
            camera_min_terrain=camera_min_terrain,
        )

        # ── 21. Smart Route diff (optional) ───────────────────────────────────
        smart_route_diff_html: str | None = None
        if result.smart_route_summary and result.pre_smart_route_utm is not None:
            pre_utm = np.asarray(result.pre_smart_route_utm)
            # Trim to same length as dense_utm (Smart Route may shift points count slightly)
            n_common = min(len(pre_utm), len(dense_utm))
            smart_route_diff_html = render_smart_route_diff_html(
                pre_utm[:n_common],
                dense_utm[:n_common],
                final_alts[:n_common],
                zone_str,
                result.smart_route_summary,
            )

        # ── 22. Combined report ────────────────────────────────────────────────
        combined_html = render_combined_html(
            map_html, chart_3d, profile_html, smart_route_diff_html
        )

        # ── 23. Mission log ────────────────────────────────────────────────────
        logger.info("Generating mission_log.txt")
        route_hash = hashlib.sha256(
            json.dumps(req.model_dump(), default=str, sort_keys=True).encode()
        ).hexdigest()[:16]
        log_txt = generate_mission_log(
            meta=meta,
            flight_cfg=fc,
            start=req.start,
            landing=req.landing,
            waypoints=req.waypoints,
            pois=pois_to_plan,
            utm_points=dense_utm,
            final_alts=final_alts,
            zone_str=zone_str,
            route_hash=route_hash,
            planning_logs=None,
            mission_name=req.name or None,
            mission_notes=req.notes or None,
        )

        logger.info(
            "Route complete: %.0f m, %.0f s, %.1f Wh (%.0f%% battery)",
            total_dist_m,
            flight_time_s,
            energy_wh,
            budget_pct,
        )

        # ── 23. Package ZIP ────────────────────────────────────────────────────
        logger.info("Assembling ZIP archive")
        kml_str = render_kml(waypoints_json)
        poi_bands_json_str: str | None = None
        if poi_band_overrides:
            poi_bands_json_str = json.dumps(
                [
                    {"start_m": s, "end_m": e, "min_agl_m": mn, "max_agl_m": mx}
                    for s, e, mn, mx in poi_band_overrides
                ]
            )

        waypoint_indices_json_str: str | None = (
            json.dumps(waypoint_indices) if waypoint_indices else None
        )

        bubble_peak_terrain_json_str = json.dumps(
            [round(float(v), 2) for v in bubble_peak_terrain.tolist()]
        )
        camera_min_terrain_json_str = json.dumps(
            [round(float(v), 2) for v in camera_min_terrain.tolist()]
        )

        zip_buf = build_zip(
            wp_json_str,
            combined_html,
            log_txt,
            kml_str=kml_str,
            agl_profile_json=agl_profile_json_str,
            poi_bands_json=poi_bands_json_str,
            waypoint_indices_json=waypoint_indices_json_str,
            meta_json=meta.model_dump_json(),
            bubble_peak_terrain_json=bubble_peak_terrain_json_str,
            camera_min_terrain_json=camera_min_terrain_json_str,
        )

        # ── 24. Store plan data for on-demand PDF generation ──────────────────
        try:
            e_min = dense_utm[:, 0].min() - config.DEM_PADDING_M
            e_max = dense_utm[:, 0].max() + config.DEM_PADDING_M
            n_min = dense_utm[:, 1].min() - config.DEM_PADDING_M
            n_max = dense_utm[:, 1].max() + config.DEM_PADDING_M
            e_grid = np.linspace(e_min, e_max, config.DEM_GRID_SIZE)
            n_grid = np.linspace(n_min, n_max, config.DEM_GRID_SIZE)
            EE, NN = np.meshgrid(e_grid, n_grid)
            grid_pts = np.column_stack([EE.ravel(), NN.ravel()])
            elev_flat = dsm_index.sample_points(grid_pts)
            terrain_grid = elev_flat.reshape(config.DEM_GRID_SIZE, config.DEM_GRID_SIZE)
            # Convert grid UTM centres to lat/lon arrays for the PDF terrain map
            tg_lons = np.array(
                [utm_to_latlon(float(e), float(n_grid.mean()), zone_str)[1] for e in e_grid]
            )
            tg_lats = np.array(
                [utm_to_latlon(float(e_grid.mean()), float(n), zone_str)[0] for n in n_grid]
            )
        except Exception as exc:
            logger.warning(
                "Terrain grid sampling skipped (PDF terrain map unavailable): %s",
                exc,
                exc_info=True,
            )
            terrain_grid = tg_lons = tg_lats = None

        lats_arr = np.array([w.lat for w in dense_wps])
        lons_arr = np.array([w.lon for w in dense_wps])

        store_plan_data(
            req.session_id,
            LastPlanData(
                lats=lats_arr,
                lons=lons_arr,
                final_alts=final_alts,
                terrain_elevs=terrain_elevs,
                agl_arr=agl_arr,
                cum_dists=cum_dists,
                cum_energy=cum_energy,
                start_index=0,
                landing_index=landing_index,
                poi_indices=poi_indices or [],
                waypoint_indices=waypoint_indices or [],
                poi_distances=poi_distances or [],
                pois=req.pois,
                meta=meta,
                fc=fc,
                route_hash=route_hash,
                mission_name=req.name or "",
                zone_str=zone_str,
                generated_at=datetime.now(UTC).isoformat(),
                terrain_grid=terrain_grid,
                terrain_grid_lons=tg_lons,
                terrain_grid_lats=tg_lats,
                waypoints_list=waypoints_json,
                no_terrain_mask=nan_mask,
                zip_bytes=zip_buf.getvalue(),
                poi_bands_list=json.loads(poi_bands_json_str) if poi_bands_json_str else None,
                bubble_peak_terrain=bubble_peak_terrain,
                camera_min_terrain=camera_min_terrain,
            ),
        )

        # Strip internal editor files before sending to the user.
        # meta.json is already embedded in zip_buf by build_zip().
        user_zip_bytes = strip_internal_files(zip_buf.getvalue())
        return user_zip_bytes, meta

    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Planning failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"Planning error: {exc}") from exc
    finally:
        _post_progress_sentinel()


async def _plan_sse_stream(
    req: RouteRequest,
    queue: asyncio.Queue,
    loop: asyncio.AbstractEventLoop,
):
    """Async generator that drives the planning thread and yields SSE events.

    The planning work runs in a thread-pool executor (via run_in_executor) so it
    can do blocking I/O without stalling the event loop.

    run_in_executor does NOT copy the caller's contextvars to the new thread, so we
    must do it explicitly: copy_context() snapshots the current Context (which already
    has _progress_ctx_var set), then pass ctx.run as the callable so the thread runs
    inside that snapshot and can read _progress_ctx_var.

    The planning thread emits progress via loop.call_soon_threadsafe → queue, and posts
    a None sentinel when it finishes.  We drain the queue here and yield each event as
    an SSE frame.
    """
    # token + reset must happen in the same Context object, so set the var here
    # (not in the outer endpoint function) before copy_context().
    token = _progress_ctx_var.set((queue, loop))
    try:
        planning_ctx = contextvars.copy_context()
        planning_task = loop.run_in_executor(None, planning_ctx.run, _run_planning_sync, req)

        # Drain progress events until the planning thread posts the None sentinel.
        # asyncio.sleep(0) after each yield gives the event loop one iteration to
        # flush the TCP write buffer before the next event, so each SSE frame is
        # sent as its own packet rather than all being batched into one.
        while True:
            event = await queue.get()
            if event is None:
                break
            yield f"data: {json.dumps(event)}\n\n"
            await asyncio.sleep(0.05)  # give uvicorn time to flush each event as its own TCP packet

        # Await the result; any exception raised in the thread is re-raised here.
        _zip_bytes, meta = await planning_task
        yield f"data: {json.dumps({'done': True, 'meta': json.loads(meta.model_dump_json())})}\n\n"
    except HTTPException as exc:
        yield f"data: {json.dumps({'error': exc.detail})}\n\n"
    except Exception as exc:
        yield f"data: {json.dumps({'error': str(exc)})}\n\n"
    finally:
        _progress_ctx_var.reset(token)


@router.post("/plan")
async def plan_route_endpoint(req: RouteRequest) -> StreamingResponse:
    """Stream planning progress as SSE, then signal completion with plan metadata."""
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue = asyncio.Queue()
    return StreamingResponse(
        _plan_sse_stream(req, queue, loop),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # disables nginx proxy buffering
        },
    )


@router.get("/plan/result")
async def plan_result_endpoint(session_id: str) -> Response:
    """Return the user ZIP from the most recent plan in this session."""
    sess = session_store.get_session(session_id)
    if sess is None or sess.last_plan is None or sess.last_plan.zip_bytes is None:
        raise HTTPException(404, "No plan result available for this session")
    user_zip_bytes = strip_internal_files(sess.last_plan.zip_bytes)
    return Response(
        content=user_zip_bytes,
        media_type="application/zip",
        headers={
            "Content-Disposition": (
                f'attachment; filename="{_zip_filename(sess.last_plan.mission_name)}"'
            ),
            "X-Plan-Meta": json.dumps(json.loads(sess.last_plan.meta.model_dump_json()), ensure_ascii=True),
        },
    )


# ── Helpers ───────────────────────────────────────────────────────────────────


def _pick_terrain(pref: str, dsm: TerrainIndex, dtm: TerrainIndex) -> TerrainIndex:
    """Return dtm or dsm based on the user preference string.

    When only one type is loaded, dtm IS dsm (same object), so "DTM" preference is safe.
    """
    return dtm if pref == "DTM" else dsm


def _violation_to_info(v: Violation, point_index: int, category: str) -> ViolationInfo:
    """Convert a core Violation to the ViolationInfo API model."""
    return ViolationInfo(
        point_index=point_index,
        kind=v.kind,
        category=category,
        description=v.message,
        lat=float(v.location.lat),
        lon=float(v.location.lon),
    )


def _resolve_dsm_dtm(
    datasets: dict,
    file_infos: dict,
) -> tuple[rasterio.DatasetReader, rasterio.DatasetReader]:
    """Pick DSM and DTM datasets from the session files."""
    file_list = list(datasets.items())
    if len(file_list) == 1:
        ds = file_list[0][1]
        return ds, ds
    if len(file_list) == 2:
        ds_a = file_list[0][1]
        ds_b = file_list[1][1]
        info_a = file_infos[file_list[0][0]]
        info_b = file_infos[file_list[1][0]]
        if info_a.inferred_type == "DSM" and info_b.inferred_type == "DTM":
            return ds_a, ds_b
        return ds_b, ds_a
    # More than 2: find one DSM and one DTM by type label
    dsm_ds = dtm_ds = None
    for name, ds in file_list:
        t = file_infos[name].inferred_type
        if t == "DSM" and dsm_ds is None:
            dsm_ds = ds
        elif t == "DTM" and dtm_ds is None:
            dtm_ds = ds
    if dsm_ds is None:
        dsm_ds = file_list[0][1]
    if dtm_ds is None:
        dtm_ds = dsm_ds
    return dsm_ds, dtm_ds


def _reorder_pois_tsp(pois: list[POIConfig], start_lat: float, start_lon: float) -> list[POIConfig]:
    """Greedy nearest-neighbor TSP reordering of POIs."""
    remaining = list(pois)
    ordered: list[POIConfig] = []
    cur_lat, cur_lon = start_lat, start_lon
    while remaining:
        nearest = min(
            remaining,
            key=lambda p: haversine_m(cur_lat, cur_lon, p.point.lat, p.point.lon),
        )
        ordered.append(nearest)
        remaining.remove(nearest)
        cur_lat, cur_lon = nearest.point.lat, nearest.point.lon
    return ordered


def _expand_maneuver_latlon(
    poi: POIConfig,
    zone_str: str,
    entry_bearing: float,
    dtm_index: TerrainIndex,
    params: FlightParams,
    *,
    prev_point: LatLon | None = None,
) -> list[LatLon]:
    """Generate 2-D LatLon maneuver pattern for a POI."""
    m = poi.maneuver
    center = LatLon(lat=poi.point.lat, lon=poi.point.lon)

    if m.type == "lawnmower":
        if m.polygon:
            return generate_lawnmower_polygon_pattern(
                m.polygon,
                m.sweep_spacing_m,
                zone_str,
                prefer_start=prev_point,
            )
        return generate_lawnmower_pattern(
            center, m.width_m, m.height_m, m.sweep_spacing_m, entry_bearing
        )

    if m.type == "warp_weft":
        if m.polygon:
            wps_a = generate_lawnmower_polygon_pattern(
                m.polygon,
                m.sweep_spacing_m,
                zone_str,
                prefer_start=prev_point,
            )
            wps_b = generate_lawnmower_polygon_pattern(
                m.polygon,
                m.sweep_spacing_m,
                zone_str,
                transpose=True,
            )
            return wps_a + wps_b
        return generate_warp_and_weft_pattern(center, m.width_m, m.height_m, m.sweep_spacing_m)

    return []


_POI_MANEUVER_ACTIONS = {"poi", "lawnmower", "warp_weft", "ramp_start"}


def _find_poi_end_indices(
    poi_start_indices: list[int],
    dense_actions: list[str],
    n_dense: int,
) -> list[int]:
    """Return the index just past the end of each POI maneuver block."""
    result = []
    for start_i in poi_start_indices:
        end_i = start_i
        while end_i < n_dense - 1 and dense_actions[end_i] in _POI_MANEUVER_ACTIONS:
            end_i += 1
        result.append(end_i)
    return result


def _find_waypoint_block_starts(dense_actions: list[str]) -> list[int]:
    """Return the first index of each contiguous 'waypoint' action block."""
    result = []
    prev = None
    for i, action in enumerate(dense_actions):
        if action == "waypoint" and prev != "waypoint":
            result.append(i)
        prev = action
    return result


def _find_poi_block_starts(dense_actions: list[str]) -> list[int]:
    """Return indices where "poi" action blocks begin."""
    result = []
    prev = None
    for i, action in enumerate(dense_actions):
        if action == "poi" and prev != "poi":
            result.append(i)
        prev = action
    return result


async def _iter_buf(buf: io.BytesIO):
    """Yield the ZIP buffer in chunks."""
    chunk_size = 65536
    while True:
        chunk = buf.read(chunk_size)
        if not chunk:
            break
        yield chunk
