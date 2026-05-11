"""
Planning pipeline: typed stage functions for the FlyHigh route-planning workflow.

Each stage is a pure function (no session I/O, no HTTP concerns) that takes only
what it needs and returns a frozen dataclass.  Stages are independently importable
and callable for testing.

Orchestrator
------------
``run_pipeline(req, dsm_ds, dtm_ds, file_infos)`` calls every stage in sequence
and returns the final (user_zip_bytes, PlanMeta) pair ready for the HTTP response.

Session loading and ``store_plan_data`` remain in ``api/plan.py`` because they
touch HTTP and session-store state.
"""

from __future__ import annotations

import hashlib
import json
import logging
from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    import rasterio

import numpy as np
import utm as _utm_lib
from scipy.spatial import KDTree

import config
from core.poi import (
    build_poi_zone,
    compute_entry_bearing,
    generate_lawnmower_pattern,
    generate_lawnmower_polygon_pattern,
    generate_smart_lawnmower_pattern,
    generate_smart_lawnmower_polygon_pattern,
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
    POI_MANEUVER_ACTIONS,
    POI_SCAN_ACTIONS,
    Action,
    AltitudeBand,
    FlightParams,
    LatLon,
    MissionInput,
    MissionResult,
    PoiZone,
    ViolationTier,
    Waypoint3D,
)
from core.utm_utils import utm_to_latlon
from export.mission_log import generate_mission_log
from export.packager import build_zip, strip_internal_files
from export.render_3d import render_3d_html
from export.render_combined import render_combined_html
from export.render_kml import render_kml
from export.render_map import render_map_html
from export.render_profile import render_profile_html
from export.render_smart_route_diff import render_smart_route_diff_html
from export.waypoints import serialise_waypoints_json, to_waypoints_json
from models import FlightConfig, ManeuverType, PlanMeta, POIConfig, RouteRequest, ViolationInfo

logger = logging.getLogger(__name__)


# ── Stage dataclasses ─────────────────────────────────────────────────────────


@dataclass(frozen=True)
class TerrainStage:
    dsm_index: TerrainIndex
    dtm_index: TerrainIndex
    bubble_terrain: TerrainIndex
    camera_terrain: TerrainIndex
    zone_str: str
    terrain_resolution_m: float | None


@dataclass(frozen=True)
class GeometryStage:
    poi_zones: list[PoiZone]
    poi_patterns: list[list[LatLon]]
    poi_maneuver_radii: list[float]
    total_covered_area_m2: float
    pois_ordered: list[POIConfig]


@dataclass(frozen=True)
class RouteStage:
    result: MissionResult
    dense_wps: list[Waypoint3D]
    dense_utm: np.ndarray
    final_alts: np.ndarray
    dense_actions: list[str]
    terrain_elevs: np.ndarray
    nan_mask: np.ndarray
    agl_arr: np.ndarray
    agl_profile_json_str: str
    cum_dists: np.ndarray
    total_dist_m: float
    landing_index: int
    n_dense: int
    min_clearance_m: float | None
    mean_clearance_m: float | None
    tight_segment_count: int | None


@dataclass(frozen=True)
class AnalysisStage:
    violations_info: list[ViolationInfo]
    poi_scan_good_pct: float | None
    flight_time_s: float
    warning: str | None
    error: str | None


@dataclass(frozen=True)
class RenderStage:
    wp_json_str: str
    waypoints_json: list
    map_html: str
    chart_3d: str
    profile_html: str
    smart_route_diff_html: str | None
    combined_html: str
    log_txt: str
    kml_str: str
    poi_band_overrides: list
    waypoint_indices: list[int]
    poi_indices: list[int]
    poi_end_indices: list[int]
    bubble_peak_terrain: np.ndarray
    camera_min_terrain: np.ndarray
    poi_bands_json_str: str | None
    waypoint_indices_json_str: str | None
    bubble_peak_terrain_json_str: str
    camera_min_terrain_json_str: str
    route_hash: str
    zip_buf_bytes: bytes
    # Terrain grid for on-demand PDF generation (None if sampling failed)
    terrain_grid: np.ndarray | None
    terrain_grid_lons: np.ndarray | None
    terrain_grid_lats: np.ndarray | None
    zone_str: str


# ── Stage functions ───────────────────────────────────────────────────────────


def run_terrain_stage(
    dsm_ds: rasterio.DatasetReader,
    dtm_ds: rasterio.DatasetReader,
    file_infos: dict,
    datasets: dict,
    fc: FlightConfig,
) -> TerrainStage:
    """Build TerrainIndex objects from open rasterio datasets."""
    terrain_resolution_m: float | None = None
    for _fname, _fi in file_infos.items():
        if datasets[_fname] is dsm_ds:
            terrain_resolution_m = round(_fi.resolution_m, 1)
            break

    logger.info("Opening raster tiles from session store")
    dsm_index = build_terrain_index(dsm_ds)
    dtm_index = build_terrain_index(dtm_ds) if dtm_ds is not dsm_ds else dsm_index

    bubble_terrain = _pick_terrain(fc.safety_radius_terrain, dsm_index, dtm_index)
    camera_terrain = _pick_terrain(fc.camera_range_terrain, dsm_index, dtm_index)

    return TerrainStage(
        dsm_index=dsm_index,
        dtm_index=dtm_index,
        bubble_terrain=bubble_terrain,
        camera_terrain=camera_terrain,
        zone_str=dtm_index.zone_str,
        terrain_resolution_m=terrain_resolution_m,
    )


def run_geometry_stage(
    req: RouteRequest,
    terrain: TerrainStage,
    params: FlightParams,
    global_band: AltitudeBand,
) -> GeometryStage:
    """Resolve POI order, build PoiZones, and generate 2-D maneuver patterns."""
    fc = req.config

    logger.info("Tracing transit legs between waypoints: %d waypoints", len(req.waypoints))
    if fc.optimize_poi_order and len(req.pois) > 2:
        pois_to_plan = _reorder_pois_tsp(req.pois, req.start.lat, req.start.lon)
        logger.info("POI order optimised (nearest-neighbor TSP)")
    else:
        pois_to_plan = list(req.pois)

    poi_zones: list[PoiZone] = []
    poi_patterns: list[list[LatLon]] = []
    poi_maneuver_radii: list[float] = []
    total_covered_area_m2: float = 0.0
    prev_point = LatLon(lat=req.start.lat, lon=req.start.lon)

    for poi_idx, poi in enumerate(pois_to_plan):
        poi_center = LatLon(lat=poi.point.lat, lon=poi.point.lon)
        entry_bearing = compute_entry_bearing(prev_point, poi_center)
        zone = build_poi_zone(
            poi, global_band, terrain.zone_str, poi_idx, entry_bearing_deg=entry_bearing
        )
        poi_zones.append(zone)
        pattern = _expand_maneuver_latlon(
            poi,
            terrain.zone_str,
            entry_bearing,
            terrain.dtm_index,
            params,
            prev_point=prev_point,
        )
        if not pattern:
            logger.warning(
                "POI %d generated 0 waypoints — polygon may be too small for sweep spacing",
                poi_idx,
            )
        poi_patterns.append(pattern)
        if pattern:
            total_covered_area_m2 += len(pattern) * poi.maneuver.sweep_spacing_m * fc.spacing_m
        poi_maneuver_radii.append(max(poi.maneuver.width_m, poi.maneuver.height_m) / 2.0)
        prev_point = pattern[-1] if pattern else poi_center

    logger.info("Generating maneuver sweeps for %d POIs", len(pois_to_plan))

    return GeometryStage(
        poi_zones=poi_zones,
        poi_patterns=poi_patterns,
        poi_maneuver_radii=poi_maneuver_radii,
        total_covered_area_m2=total_covered_area_m2,
        pois_ordered=pois_to_plan,
    )


def run_route_stage(
    req: RouteRequest,
    terrain: TerrainStage,
    geometry: GeometryStage,
    params: FlightParams,
    fc: FlightConfig,
) -> RouteStage:
    """Call plan_route() and derive the dense numpy arrays needed by later stages."""
    mission = MissionInput(
        dsm=terrain.dsm_index,
        dtm=terrain.dtm_index,
        start=LatLon(lat=req.start.lat, lon=req.start.lon),
        waypoints=[LatLon(lat=w.lat, lon=w.lon) for w in req.waypoints],
        poi_zones=geometry.poi_zones,
        poi_2d_waypoints=geometry.poi_patterns,
        landing=LatLon(lat=req.landing.lat, lon=req.landing.lon),
        params=params,
        bubble_terrain=terrain.bubble_terrain,
        camera_terrain=terrain.camera_terrain,
    )
    result = plan_route(mission)

    dense_wps = result.waypoints_3d
    n_dense = len(dense_wps)
    dense_utm = result.dense_utm
    final_alts = np.array([w.alt_msl for w in dense_wps])
    dense_actions = [w.action for w in dense_wps]

    terrain_elevs = terrain.dtm_index.sample_points(dense_utm)
    nan_mask = np.isnan(terrain_elevs)
    if nan_mask.all():
        from fastapi import HTTPException

        raise HTTPException(
            status_code=422,
            detail="Terrain raster contains no valid elevation data — check that the uploaded file covers the mission area.",
        )
    if nan_mask.any():
        valid = terrain_elevs[~nan_mask]
        safe_fill = float(valid.max()) + fc.max_agl_m
        terrain_elevs = np.where(nan_mask, safe_fill, terrain_elevs)

    agl_arr = final_alts - terrain_elevs
    agl_arr_profile = np.where(nan_mask, 999.0, agl_arr)
    agl_profile_json_str = json.dumps([round(float(v), 1) for v in agl_arr_profile.tolist()])

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
    landing_index = next(
        (i for i in range(n_dense - 1, -1, -1) if dense_actions[i] == Action.LAND),
        n_dense - 1,
    )

    return RouteStage(
        result=result,
        dense_wps=dense_wps,
        dense_utm=dense_utm,
        final_alts=final_alts,
        dense_actions=dense_actions,
        terrain_elevs=terrain_elevs,
        nan_mask=nan_mask,
        agl_arr=agl_arr,
        agl_profile_json_str=agl_profile_json_str,
        cum_dists=cum_dists,
        total_dist_m=total_dist_m,
        landing_index=landing_index,
        n_dense=n_dense,
        min_clearance_m=min_clearance_m,
        mean_clearance_m=mean_clearance_m,
        tight_segment_count=tight_segment_count,
    )


def run_analysis_stage(
    route: RouteStage,
    terrain: TerrainStage,
) -> AnalysisStage:
    """Map violations, compute quality metrics."""
    dense_utm = route.dense_utm
    dense_actions = route.dense_actions
    n_dense = route.n_dense

    # Map violations to ViolationInfo
    if n_dense > 0:
        kd_tree = KDTree(dense_utm)
    else:
        kd_tree = None

    violations_info: list[ViolationInfo] = []
    if route.result.violations:
        if kd_tree is not None:
            viol_locs = np.array(
                [
                    _utm_lib.from_latlon(v.location.lat, v.location.lon)[:2]
                    for v in route.result.violations
                ]
            )
            _, nearest_indices = kd_tree.query(viol_locs)
            point_indices = nearest_indices.tolist()
        else:
            point_indices = [0] * len(route.result.violations)
        for v, pidx in zip(route.result.violations, point_indices):
            if v.tier == ViolationTier.HARD:
                category = "safety"
            elif dense_actions[pidx] in POI_SCAN_ACTIONS:
                category = "product_poi"
            else:
                category = "product_route"
            violations_info.append(_violation_to_info(v, int(pidx), category))

    # POI scan quality
    poi_mask = np.array([a in POI_SCAN_ACTIONS for a in dense_actions])
    poi_total = int(poi_mask.sum())
    if poi_total > 0:
        poi_violated_indices = {
            v.point_index for v in violations_info if v.category == "product_poi"
        }
        poi_scan_good_pct: float | None = round(
            (1 - len(poi_violated_indices) / poi_total) * 100, 1
        )
    else:
        poi_scan_good_pct = None

    warning: str | None = None
    error: str | None = None
    if terrain.terrain_resolution_m is not None and terrain.terrain_resolution_m > 20.0:
        warning = f"Terrain resolution is coarse ({terrain.terrain_resolution_m:.0f} m/px) - altitude clearances may be less accurate."

    return AnalysisStage(
        violations_info=violations_info,
        poi_scan_good_pct=poi_scan_good_pct,
        flight_time_s=route.result.flight_time_s,
        warning=warning,
        error=error,
    )


def run_render_stage(
    req: RouteRequest,
    terrain: TerrainStage,
    route: RouteStage,
    analysis: AnalysisStage,
    geometry: GeometryStage,
    params: FlightParams,
    fc: FlightConfig,
    meta: PlanMeta,
) -> RenderStage:
    """Render all HTML outputs, build the ZIP, compute cumulative energy."""
    dense_utm = route.dense_utm
    final_alts = route.final_alts
    dense_actions = route.dense_actions
    cum_dists = route.cum_dists
    n_dense = route.n_dense
    landing_index = route.landing_index
    violations_info = analysis.violations_info

    waypoint_indices = _find_waypoint_block_starts(dense_actions)
    poi_indices = _find_poi_block_starts(dense_actions)
    poi_end_indices = _find_poi_end_indices(poi_indices or [], dense_actions, n_dense)

    headings = compute_headings(dense_utm)

    logger.info("Writing waypoints.json: %d dense waypoints", n_dense)
    waypoints_json = to_waypoints_json(
        dense_utm,
        final_alts,
        headings,
        terrain.zone_str,
        speed_ms=fc.cruise_speed_ms,
        actions=dense_actions,
    )
    wp_json_str = serialise_waypoints_json(waypoints_json)

    poi_distances = [float(cum_dists[i]) for i in poi_indices] if poi_indices else []

    poi_band_overrides: list[tuple[float, float, float, float]] = []
    for poi_idx_in_list, poi in enumerate(geometry.pois_ordered):
        m = poi.maneuver
        if m.poi_min_agl_m is None and m.poi_max_agl_m is None:
            continue
        poi_min = m.poi_min_agl_m if m.poi_min_agl_m is not None else fc.min_agl_m
        poi_max = m.poi_max_agl_m if m.poi_max_agl_m is not None else fc.max_agl_m
        if poi_idx_in_list < len(poi_indices) and poi_idx_in_list < len(poi_end_indices):
            start_d = float(cum_dists[poi_indices[poi_idx_in_list]])
            end_d = float(cum_dists[min(poi_end_indices[poi_idx_in_list], n_dense - 1)])
            poi_band_overrides.append((start_d, end_d, poi_min, poi_max))

    map_html = render_map_html(
        dense_utm,
        final_alts,
        terrain.zone_str,
        fc,
        start_index=0,
        waypoint_indices=waypoint_indices,
        poi_indices=poi_indices,
        poi_maneuver_radii=geometry.poi_maneuver_radii,
        violations=[(v.point_index, v.description, v.category) for v in violations_info],
        landing_index=landing_index,
    )

    chart_3d = render_3d_html(
        dense_utm,
        final_alts,
        terrain.dsm_index,
        terrain.zone_str,
        poi_indices=poi_indices,
    )

    return_home_dist = (
        float(cum_dists[poi_end_indices[-1]])
        if poi_end_indices
        else float(cum_dists[landing_index])
        if landing_index < n_dense
        else route.total_dist_m
    )

    bubble_peak_terrain, camera_min_terrain = compute_profile_bands(
        dense_utm, route.terrain_elevs, terrain.bubble_terrain, terrain.camera_terrain, params
    )

    poi_scan_areas = [
        (float(cum_dists[s]), float(cum_dists[min(e, n_dense - 1)]))
        for s, e in zip(poi_indices or [], poi_end_indices or [])
    ]

    profile_html = render_profile_html(
        dense_utm,
        final_alts,
        route.terrain_elevs,
        cum_dists,
        fc,
        poi_distances=poi_distances or None,
        return_home_distance=return_home_dist,
        poi_band_overrides=poi_band_overrides or None,
        poi_scan_areas=poi_scan_areas or None,
        violation_points=[(v.point_index, v.category) for v in violations_info] or None,
        bubble_peak_terrain=bubble_peak_terrain,
        camera_min_terrain=camera_min_terrain,
    )

    smart_route_diff_html: str | None = None
    if route.result.smart_route_summary and route.result.pre_smart_route_utm is not None:
        pre_utm = np.asarray(route.result.pre_smart_route_utm)
        n_common = min(len(pre_utm), len(dense_utm))
        smart_route_diff_html = render_smart_route_diff_html(
            pre_utm[:n_common],
            dense_utm[:n_common],
            final_alts[:n_common],
            terrain.zone_str,
            route.result.smart_route_summary,
        )

    combined_html = render_combined_html(map_html, chart_3d, profile_html, smart_route_diff_html)

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
        pois=geometry.pois_ordered,
        utm_points=dense_utm,
        final_alts=final_alts,
        zone_str=terrain.zone_str,
        route_hash=route_hash,
        planning_logs=None,
        mission_name=req.name or None,
        mission_notes=req.notes or None,
    )

    logger.info(
        "Route complete: %.0f m, %.0f s",
        route.total_dist_m,
        analysis.flight_time_s,
    )

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
        agl_profile_json=route.agl_profile_json_str,
        poi_bands_json=poi_bands_json_str,
        waypoint_indices_json=waypoint_indices_json_str,
        meta_json=meta.model_dump_json(),
        bubble_peak_terrain_json=bubble_peak_terrain_json_str,
        camera_min_terrain_json=camera_min_terrain_json_str,
    )

    # ── Terrain grid for PDF generation ───────────────────────────────────────
    terrain_grid: np.ndarray | None = None
    terrain_grid_lons: np.ndarray | None = None
    terrain_grid_lats: np.ndarray | None = None
    try:
        e_min = dense_utm[:, 0].min() - config.DEM_PADDING_M
        e_max = dense_utm[:, 0].max() + config.DEM_PADDING_M
        n_min = dense_utm[:, 1].min() - config.DEM_PADDING_M
        n_max = dense_utm[:, 1].max() + config.DEM_PADDING_M
        e_grid = np.linspace(e_min, e_max, config.DEM_GRID_SIZE)
        n_grid = np.linspace(n_min, n_max, config.DEM_GRID_SIZE)
        EE, NN = np.meshgrid(e_grid, n_grid)
        grid_pts = np.column_stack([EE.ravel(), NN.ravel()])
        elev_flat = terrain.dsm_index.sample_points(grid_pts)
        terrain_grid = elev_flat.reshape(config.DEM_GRID_SIZE, config.DEM_GRID_SIZE)
        terrain_grid_lons = np.array(
            [utm_to_latlon(float(e), float(n_grid.mean()), terrain.zone_str)[1] for e in e_grid]
        )
        terrain_grid_lats = np.array(
            [utm_to_latlon(float(e_grid.mean()), float(n), terrain.zone_str)[0] for n in n_grid]
        )
    except Exception as exc:
        logger.warning(
            "Terrain grid sampling skipped (PDF terrain map unavailable): %s",
            exc,
            exc_info=True,
        )

    return RenderStage(
        wp_json_str=wp_json_str,
        waypoints_json=waypoints_json,
        map_html=map_html,
        chart_3d=chart_3d,
        profile_html=profile_html,
        smart_route_diff_html=smart_route_diff_html,
        combined_html=combined_html,
        log_txt=log_txt,
        kml_str=kml_str,
        poi_band_overrides=poi_band_overrides,
        waypoint_indices=waypoint_indices,
        poi_indices=poi_indices,
        poi_end_indices=poi_end_indices,
        bubble_peak_terrain=bubble_peak_terrain,
        camera_min_terrain=camera_min_terrain,
        poi_bands_json_str=poi_bands_json_str,
        waypoint_indices_json_str=waypoint_indices_json_str,
        bubble_peak_terrain_json_str=bubble_peak_terrain_json_str,
        camera_min_terrain_json_str=camera_min_terrain_json_str,
        route_hash=route_hash,
        zip_buf_bytes=zip_buf.getvalue(),
        terrain_grid=terrain_grid,
        terrain_grid_lons=terrain_grid_lons,
        terrain_grid_lats=terrain_grid_lats,
        zone_str=terrain.zone_str,
    )


# ── Orchestrator ──────────────────────────────────────────────────────────────


def run_pipeline(
    req: RouteRequest,
    dsm_ds: rasterio.DatasetReader,
    dtm_ds: rasterio.DatasetReader,
    file_infos: dict,
    datasets: dict,
) -> tuple[bytes, PlanMeta, RouteStage, RenderStage]:
    """Run the full planning pipeline.

    Returns (user_zip_bytes, meta, route, render) so the caller (plan.py) can
    access the arrays it needs for ``store_plan_data`` without re-computing them.

    Raises ``fastapi.HTTPException`` on unrecoverable input errors.
    """
    from fastapi import HTTPException

    fc = req.config
    params = FlightParams(
        min_agl_m=fc.min_agl_m,
        max_agl_m=fc.max_agl_m,
        cruise_speed_ms=fc.cruise_speed_ms,
        climb_rate_ms=fc.climb_rate_ms,
        spacing_m=fc.spacing_m,
        point_radius_m=fc.point_radius_m,
        max_surface_radius_m=fc.max_surface_radius_m,
        takeoff_alt_msl=req.takeoff_alt_m,
        optimize_poi_order=fc.optimize_poi_order,
        smart_route_corridor_m=fc.smart_route_corridor_m if fc.smart_route else None,
        min_step_m=fc.min_altitude_step_m,
        max_slope_ratio=fc.max_slope_ratio,
    )
    global_band = AltitudeBand(min_agl_m=params.min_agl_m, max_agl_m=params.max_agl_m)

    # Zone validation
    all_latlon_points = (
        [req.start] + req.waypoints + [poi.point for poi in req.pois] + [req.landing]
    )
    try:
        detect_mission_zone(all_latlon_points)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    terrain = run_terrain_stage(dsm_ds, dtm_ds, file_infos, datasets, fc)
    geometry = run_geometry_stage(req, terrain, params, global_band)
    route = run_route_stage(req, terrain, geometry, params, fc)
    analysis = run_analysis_stage(route, terrain)

    meta = PlanMeta(
        total_distance_m=round(route.total_dist_m, 1),
        flight_time_s=round(analysis.flight_time_s, 1),
        violations=analysis.violations_info,
        warning=analysis.warning,
        error=analysis.error,
        smart_route_summary=route.result.smart_route_summary,
        terrain_resolution_m=terrain.terrain_resolution_m,
        covered_area_m2=(
            round(geometry.total_covered_area_m2, 1) if geometry.total_covered_area_m2 > 0 else None
        ),
        min_clearance_m=route.min_clearance_m,
        mean_clearance_m=route.mean_clearance_m,
        tight_segment_count=route.tight_segment_count,
        min_agl_m=fc.min_agl_m,
        max_agl_m=fc.max_agl_m,
        poi_scan_good_pct=analysis.poi_scan_good_pct,
    )

    render = run_render_stage(req, terrain, route, analysis, geometry, params, fc, meta)
    user_zip_bytes = strip_internal_files(render.zip_buf_bytes)
    return user_zip_bytes, meta, route, render


# ── Private helpers (mirrors of plan.py helpers) ──────────────────────────────


def _pick_terrain(pref: str, dsm: TerrainIndex, dtm: TerrainIndex) -> TerrainIndex:
    return dtm if pref == "DTM" else dsm


def _violation_to_info(v, point_index: int, category: str) -> ViolationInfo:
    return ViolationInfo(
        point_index=point_index,
        kind=v.kind,
        category=category,
        description=v.message,
        lat=float(v.location.lat),
        lon=float(v.location.lon),
    )


def _reorder_pois_tsp(pois: list[POIConfig], start_lat: float, start_lon: float) -> list[POIConfig]:
    from core.utm_utils import haversine_m

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
    m = poi.maneuver
    center = LatLon(lat=poi.point.lat, lon=poi.point.lon)
    if m.type == ManeuverType.LAWNMOWER:
        if m.polygon:
            return generate_lawnmower_polygon_pattern(
                m.polygon, m.sweep_spacing_m, zone_str, prefer_start=prev_point
            )
        return generate_lawnmower_pattern(
            center, m.width_m, m.height_m, m.sweep_spacing_m, entry_bearing
        )
    if m.type == ManeuverType.WARP_WEFT:
        if m.polygon:
            wps_a = generate_lawnmower_polygon_pattern(
                m.polygon, m.sweep_spacing_m, zone_str, prefer_start=prev_point
            )
            wps_b = generate_lawnmower_polygon_pattern(
                m.polygon, m.sweep_spacing_m, zone_str, transpose=True
            )
            return wps_a + wps_b
        return generate_warp_and_weft_pattern(center, m.width_m, m.height_m, m.sweep_spacing_m)
    if m.type == ManeuverType.SMART_LAWNMOWER:
        h = m.poi_max_agl_m if m.poi_max_agl_m is not None else params.max_agl_m
        if m.polygon:
            return generate_smart_lawnmower_polygon_pattern(
                m.polygon, h, m.smart_fov_deg, m.smart_overlap, zone_str, prefer_start=prev_point
            )
        return generate_smart_lawnmower_pattern(
            center, m.width_m, m.height_m, h, m.smart_fov_deg, m.smart_overlap, entry_bearing
        )
    return []


def _find_waypoint_block_starts(dense_actions: list[str]) -> list[int]:
    result = []
    prev = None
    for i, action in enumerate(dense_actions):
        if action == Action.WAYPOINT and prev != Action.WAYPOINT:
            result.append(i)
        prev = action
    return result


def _find_poi_block_starts(dense_actions: list[str]) -> list[int]:
    """Return indices where a new POI zone starts (action transitions to Action.POI).

    Action.POI is the explicit entry marker for the first waypoint of each POI zone;
    using it (not POI_SCAN_ACTIONS) avoids false triggers from ramp_start interruptions
    within a zone.
    """
    result = []
    prev = None
    for i, action in enumerate(dense_actions):
        if action == Action.POI and prev != Action.POI:
            result.append(i)
        prev = action
    return result


def _find_poi_end_indices(
    poi_start_indices: list[int],
    dense_actions: list[str],
    n_dense: int,
) -> list[int]:
    result = []
    for start_i in poi_start_indices:
        end_i = start_i
        while end_i < n_dense - 1 and dense_actions[end_i] in POI_MANEUVER_ACTIONS:
            end_i += 1
        result.append(end_i)
    return result
