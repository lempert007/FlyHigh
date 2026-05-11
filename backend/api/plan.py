"""
POST /plan — compute a terrain-following flight route and return a ZIP download.

Session loading and store_plan_data are the only API-layer concerns here.
All planning logic lives in core/pipeline.py.
"""

from __future__ import annotations

import json
import logging
import re
from datetime import UTC, date, datetime
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    import rasterio

import numpy as np
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

import session as session_store
from core.pipeline import run_pipeline
from models import PlanMeta, RouteRequest
from session import LastPlanData, store_plan_data

logger = logging.getLogger(__name__)

router = APIRouter()


def _zip_filename(mission_name: str) -> str:
    slug = re.sub(r"[^\w\-]", "_", (mission_name or "mission").strip())[:40].strip("_") or "mission"
    return f"{slug}_{date.today().strftime('%Y%m%d')}.zip"


def _run_planning_sync(req: RouteRequest) -> tuple[bytes, PlanMeta]:
    """Synchronous planning worker. Returns (user_zip_bytes, meta)."""
    logger.info(
        "Planning route: %d POIs, %d waypoints, smart_route=%s",
        len(req.pois),
        len(req.waypoints),
        req.config.smart_route,
    )

    # ── 1. Load session ────────────────────────────────────────────────────────
    sess = session_store.get_session(req.session_id)
    if sess is None:
        raise HTTPException(
            status_code=404, detail=f"Session {req.session_id!r} not found or expired"
        )
    if not sess.files:
        raise HTTPException(status_code=400, detail="Session contains no uploaded terrain files")

    datasets = {name: sf.dataset for name, sf in sess.files.items()}
    file_infos = {name: sf.info for name, sf in sess.files.items()}

    try:
        # ── 2. Resolve DSM / DTM datasets ─────────────────────────────────────
        dsm_ds, dtm_ds = _resolve_dsm_dtm(datasets, file_infos)

        # ── 3–23. Run planning pipeline ────────────────────────────────────────
        user_zip_bytes, meta, route, render = run_pipeline(
            req, dsm_ds, dtm_ds, file_infos, datasets
        )

        # ── 24. Store plan data for on-demand PDF generation ──────────────────
        dense_wps = route.dense_wps
        lats_arr = np.array([w.lat for w in dense_wps])
        lons_arr = np.array([w.lon for w in dense_wps])
        poi_distances = (
            [float(route.cum_dists[i]) for i in render.poi_indices] if render.poi_indices else []
        )

        store_plan_data(
            req.session_id,
            LastPlanData(
                lats=lats_arr,
                lons=lons_arr,
                final_alts=route.final_alts,
                terrain_elevs=route.terrain_elevs,
                agl_arr=route.agl_arr,
                cum_dists=route.cum_dists,
                start_index=0,
                landing_index=route.landing_index,
                poi_indices=render.poi_indices or [],
                waypoint_indices=render.waypoint_indices or [],
                poi_distances=poi_distances,
                pois=req.pois,
                meta=meta,
                fc=req.config,
                route_hash=render.route_hash,
                mission_name=req.name or "",
                zone_str=render.zone_str,
                generated_at=datetime.now(UTC).isoformat(),
                terrain_grid=render.terrain_grid,
                terrain_grid_lons=render.terrain_grid_lons,
                terrain_grid_lats=render.terrain_grid_lats,
                waypoints_list=render.waypoints_json,
                no_terrain_mask=route.nan_mask,
                zip_bytes=render.zip_buf_bytes,
                poi_bands_list=(
                    json.loads(render.poi_bands_json_str) if render.poi_bands_json_str else None
                ),
                bubble_peak_terrain=render.bubble_peak_terrain,
                camera_min_terrain=render.camera_min_terrain,
            ),
        )

        return user_zip_bytes, meta

    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Planning failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"Planning error: {exc}") from exc


@router.post("/plan")
def plan_route_endpoint(req: RouteRequest) -> Response:
    """Compute an optimised terrain-following route and return a ZIP file."""
    zip_bytes, meta = _run_planning_sync(req)
    return Response(
        content=zip_bytes,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{_zip_filename(req.name)}"',
            # Violations are sent inside the ZIP (meta.json) to avoid HTTP header size limits.
            # The header carries only the numeric/string summary fields for quick access.
            "X-Plan-Meta": json.dumps(
                {k: v for k, v in json.loads(meta.model_dump_json()).items() if k != "violations"},
                ensure_ascii=True,
            ),
        },
    )


@router.get("/plan/result")
async def plan_result_endpoint(session_id: str) -> Response:
    """Return the user ZIP from the most recent plan in this session."""
    sess = session_store.get_session(session_id)
    if sess is None or sess.last_plan is None or sess.last_plan.zip_bytes is None:
        raise HTTPException(404, "No plan result available for this session")
    from export.packager import strip_internal_files

    user_zip_bytes = strip_internal_files(sess.last_plan.zip_bytes)
    return Response(
        content=user_zip_bytes,
        media_type="application/zip",
        headers={
            "Content-Disposition": (
                f'attachment; filename="{_zip_filename(sess.last_plan.mission_name)}"'
            ),
            "X-Plan-Meta": json.dumps(
                json.loads(sess.last_plan.meta.model_dump_json()), ensure_ascii=True
            ),
        },
    )


# ── Helpers ───────────────────────────────────────────────────────────────────


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
