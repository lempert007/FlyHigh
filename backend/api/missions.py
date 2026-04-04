"""
Mission library CRUD API.
All routes are prefixed with /missions.
"""

from __future__ import annotations

import io
import json
import math
import os
import zipfile

import numpy as np
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, StreamingResponse

import session as session_store
from api.editor_data import _build_profile_points
from core.altitude_edit_utils import patch_plan_zip
from core.missions import (
    _plan_zip_path,
    _thumbnail_path,
    _validate_folder,
    create_mission,
    delete_mission,
    list_missions,
    load_mission,
    load_plan_meta,
    save_mission,
    save_plan,
)
from export.packager import strip_internal_files
from models import (
    AltEditBody,
    CreateMissionRequest,
    MissionSummary,
    PlanMeta,
    SaveFromSessionBody,
    SaveMissionRequest,
)

router = APIRouter(prefix="/missions", tags=["missions"])


@router.get("", response_model=list[MissionSummary])
async def get_missions() -> list[dict]:
    return list_missions()


@router.post("", status_code=201)
async def post_mission(req: CreateMissionRequest) -> dict:
    folder = create_mission(req.name)
    data = load_mission(folder)
    return {
        "folder": folder,
        "name": data["name"],
        "status": data["status"],
        "created_at": data["created_at"],
        "updated_at": data["updated_at"],
        "has_thumbnail": False,
    }


@router.get("/{folder}")
async def get_mission(folder: str) -> dict:
    try:
        _validate_folder(folder)
        data = load_mission(folder)
        data["plan_meta"] = load_plan_meta(folder)
        return data
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Mission {folder!r} not found")
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@router.put("/{folder}/plan", status_code=204)
async def save_mission_plan(folder: str, request: Request) -> None:
    try:
        _validate_folder(folder)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    zip_bytes = await request.body()
    if not zip_bytes:
        raise HTTPException(status_code=422, detail="Empty body")
    try:
        save_plan(folder, zip_bytes)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Mission {folder!r} not found")


@router.get("/{folder}/plan")
async def get_mission_plan(folder: str) -> FileResponse:
    try:
        _validate_folder(folder)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    path = _plan_zip_path(folder)
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="No saved plan for this mission")
    return FileResponse(path, media_type="application/zip", filename=f"{folder}_plan.zip")


@router.put("/{folder}/plan-from-session", status_code=204)
async def save_plan_from_session_route(folder: str, body: SaveFromSessionBody) -> None:
    """Save the full internal plan ZIP (including editor-internal files) from an active session."""
    try:
        _validate_folder(folder)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    data = session_store.get_plan_data(body.session_id)
    if data is None or data.zip_bytes is None:
        raise HTTPException(status_code=404, detail="No plan data found for this session")
    try:
        save_plan(folder, data.zip_bytes)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Mission {folder!r} not found")


@router.get("/{folder}/editor-data")
async def get_mission_editor_data(folder: str) -> dict:
    """Serve altitude editor data from the saved plan ZIP (no active session required)."""
    try:
        _validate_folder(folder)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    zip_path = _plan_zip_path(folder)
    if not os.path.isfile(zip_path):
        raise HTTPException(
            status_code=404, detail="No saved plan for this mission — plan the route first."
        )
    try:
        with open(zip_path, "rb") as f:
            zb = f.read()
        with zipfile.ZipFile(io.BytesIO(zb), "r") as zf:
            names = set(zf.namelist())
            wps = json.loads(zf.read("waypoints.json"))
            agl = [round(float(v), 2) for v in json.loads(zf.read("agl_profile.json"))]
            poi_bands = json.loads(zf.read("poi_bands.json")) if "poi_bands.json" in names else None
            wp_indices = (
                json.loads(zf.read("waypoint_indices.json"))
                if "waypoint_indices.json" in names
                else None
            )
            bubble_peak = (
                json.loads(zf.read("bubble_peak_terrain.json"))
                if "bubble_peak_terrain.json" in names
                else None
            )
            camera_min = (
                json.loads(zf.read("camera_min_terrain.json"))
                if "camera_min_terrain.json" in names
                else None
            )

        # Derive POI block starts from action strings
        _POI_BLOCK_ACTIONS = frozenset({"poi", "lawnmower", "warp_weft", "smart_lawnmower"})
        poi_indices: list[int] = []
        prev_in_poi = False
        for i, wp in enumerate(wps):
            in_poi = wp.get("action", "") in _POI_BLOCK_ACTIONS
            if in_poi and not prev_in_poi:
                poi_indices.append(i)
            prev_in_poi = in_poi

        # Build cumulative distances for profile points
        _R = 6_371_000
        cum_dists_list = [0.0]
        for i in range(1, len(wps)):
            lat1, lon1 = wps[i - 1]["lat"], wps[i - 1]["lon"]
            lat2, lon2 = wps[i]["lat"], wps[i]["lon"]
            phi1, phi2 = math.radians(lat1), math.radians(lat2)
            dphi = math.radians(lat2 - lat1)
            dlam = math.radians(lon2 - lon1)
            a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
            cum_dists_list.append(cum_dists_list[-1] + _R * 2 * math.asin(math.sqrt(a)))

        profile_points = _build_profile_points(wps, cum_dists_list, poi_indices, wp_indices or [])

        return {
            "waypoints": wps,
            "agl_profile": agl,
            "poi_bands": poi_bands,
            "waypoint_indices": wp_indices,
            "bubble_peak_terrain": bubble_peak,
            "camera_min_terrain": camera_min,
            "profile_points": profile_points,
        }
    except KeyError:
        raise HTTPException(
            status_code=409, detail="Plan ZIP is missing required files — re-plan the route."
        )


@router.post("/{folder}/altitude-edit")
async def apply_folder_altitude_edit(folder: str, body: AltEditBody) -> StreamingResponse:
    """Apply altitude overrides to a saved plan (no active session required)."""
    try:
        _validate_folder(folder)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    zip_path = _plan_zip_path(folder)
    if not os.path.isfile(zip_path):
        raise HTTPException(status_code=404, detail="No saved plan for this mission")

    with open(zip_path, "rb") as f:
        zip_bytes = f.read()

    try:
        with zipfile.ZipFile(io.BytesIO(zip_bytes), "r") as zf:
            wps = json.loads(zf.read("waypoints.json"))
            old_agl = np.array(json.loads(zf.read("agl_profile.json")), dtype=float)
            meta = PlanMeta(**json.loads(zf.read("meta.json")))
    except KeyError:
        raise HTTPException(
            status_code=409, detail="Plan ZIP is missing required files — re-plan the route."
        )

    old_alts = np.array([wp["alt_m"] for wp in wps], dtype=float)
    terrain_elevs = old_alts - old_agl
    lats = np.array([wp["lat"] for wp in wps], dtype=float)
    lons = np.array([wp["lon"] for wp in wps], dtype=float)
    min_agl_m = meta.min_agl_m if meta.min_agl_m is not None else 0.0

    try:
        new_zip_bytes, _ = patch_plan_zip(
            zip_bytes=zip_bytes,
            alt_overrides=body.alt_overrides,
            terrain_elevs=terrain_elevs,
            min_agl_m=min_agl_m,
            max_agl_m=meta.max_agl_m,
            lats=lats,
            lons=lons,
            original_meta=meta,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    save_plan(folder, new_zip_bytes)
    user_zip = strip_internal_files(new_zip_bytes)
    return StreamingResponse(
        iter([user_zip]),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="flyhigh_edited_{folder[:8]}.zip"'},
    )


@router.put("/{folder}", status_code=200)
async def put_mission(folder: str, req: SaveMissionRequest) -> dict:
    try:
        _validate_folder(folder)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    try:
        existing = load_mission(folder)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Mission {folder!r} not found")

    data = {
        "schema_version": 1,
        "name": req.name,
        "status": req.status.value,
        "notes": req.notes,
        "created_at": existing.get("created_at", ""),
        "tiff_selections": [s.model_dump() for s in req.tiff_selections],
        "route": req.route,
        "preset_name": req.preset_name,
    }
    save_mission(folder, data)
    return {"ok": True}


@router.delete("/{folder}", status_code=204)
async def delete_mission_route(folder: str) -> None:
    try:
        _validate_folder(folder)
        delete_mission(folder)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Mission {folder!r} not found")
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@router.get("/{folder}/thumbnail")
async def get_thumbnail(folder: str) -> FileResponse:
    try:
        _validate_folder(folder)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    path = _thumbnail_path(folder)
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="Thumbnail not available")
    return FileResponse(path, media_type="image/png")
