"""
POST /plan/{session_id}/altitude-edit

Apply manually-edited altitude overrides to a planned route.
Runs a lightweight safety re-check (AGL band only — path geometry is unchanged)
and returns:
  - ZIP body: full plan ZIP with updated waypoints.json, waypoints.kml, agl_profile.json,
    and meta.json (refreshed PlanMeta with updated violations and clearance stats)
"""

from __future__ import annotations

import dataclasses

import numpy as np
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

import session as session_store
from core.altitude_edit_utils import patch_plan_zip
from export.packager import strip_internal_files
from models import AltEditBody

router = APIRouter(prefix="/plan", tags=["altitude-edit"])


@router.post("/{session_id}/altitude-edit")
async def apply_altitude_edit(
    session_id: str,
    body: AltEditBody,
) -> StreamingResponse:
    """Replace alt_m values, re-run AGL safety check, return updated ZIP + PlanMeta."""
    data = session_store.get_plan_data(session_id)
    if data is None:
        raise HTTPException(404, "No plan found for this session. Plan a route first.")
    if not data.waypoints_list:
        raise HTTPException(
            409, "Waypoint data not available — re-plan to enable altitude editing."
        )

    min_agl_m = data.meta.min_agl_m if data.meta.min_agl_m is not None else 0.0
    valid_mask = (
        ~data.no_terrain_mask
        if data.no_terrain_mask is not None
        else np.ones(len(data.waypoints_list), dtype=bool)
    )
    new_alts = np.array(body.alt_overrides, dtype=float)
    new_agl = new_alts - data.terrain_elevs
    valid_agl = new_agl[valid_mask]

    try:
        new_zip_bytes, updated_meta = patch_plan_zip(
            zip_bytes=data.zip_bytes or _build_minimal_zip(data),
            alt_overrides=body.alt_overrides,
            terrain_elevs=data.terrain_elevs,
            min_agl_m=min_agl_m,
            max_agl_m=data.meta.max_agl_m,
            lats=data.lats,
            lons=data.lons,
            original_meta=data.meta,
        )
    except ValueError as exc:
        raise HTTPException(422, str(exc))

    # Patch extra clearance stats that only the session version knows about (valid_mask)
    updated_meta = updated_meta.model_copy(
        update={
            "min_clearance_m": round(float(np.min(valid_agl)), 1) if len(valid_agl) > 0 else None,
            "mean_clearance_m": round(float(np.mean(valid_agl)), 1) if len(valid_agl) > 0 else None,
        }
    )

    session_store.store_plan_data(
        session_id,
        dataclasses.replace(
            data,
            final_alts=new_alts,
            agl_arr=new_agl,
            meta=updated_meta,
            waypoints_list=[
                {**wp, "alt_m": round(float(a), 2)} for wp, a in zip(data.waypoints_list, new_alts)
            ],
            zip_bytes=new_zip_bytes,
        ),
    )

    user_zip_bytes = strip_internal_files(new_zip_bytes)
    filename = f"flyhigh_edited_{data.route_hash[:8]}.zip"
    return StreamingResponse(
        iter([user_zip_bytes]),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _build_minimal_zip(data) -> bytes:
    """Fallback: build a minimal ZIP for sessions created before zip_bytes was stored."""
    import io
    import json
    import zipfile

    from export.render_kml import render_kml
    from export.waypoints import serialise_waypoints_json

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("waypoints.json", serialise_waypoints_json(data.waypoints_list).encode())
        zf.writestr("waypoints.kml", render_kml(data.waypoints_list).encode())
        zf.writestr(
            "agl_profile.json", json.dumps([round(float(v), 2) for v in data.agl_arr]).encode()
        )
        zf.writestr("meta.json", data.meta.model_dump_json().encode())
    return buf.getvalue()
