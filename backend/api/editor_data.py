"""
GET /plan/{session_id}/editor-data

Returns the data needed by the interactive altitude editor as JSON.
Reads directly from session state so it always reflects the latest
altitude edits — no need for the frontend to parse the download ZIP.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

import session as session_store

router = APIRouter(prefix="/plan", tags=["editor-data"])


@router.get("/{session_id}/editor-data")
async def get_editor_data(session_id: str) -> dict:
    """Return waypoints, AGL profile, POI bands and waypoint indices for the editor."""
    data = session_store.get_plan_data(session_id)
    if data is None:
        raise HTTPException(status_code=404, detail="No plan found for this session.")
    if not data.waypoints_list:
        raise HTTPException(
            status_code=409,
            detail="Waypoint data not available — re-plan the route to enable editing.",
        )

    return {
        "waypoints": data.waypoints_list,
        "agl_profile": [round(float(v), 2) for v in data.agl_arr],
        "poi_bands": data.poi_bands_list,
        "waypoint_indices": data.waypoint_indices,
        "bubble_peak_terrain": (
            [round(float(v), 2) for v in data.bubble_peak_terrain]
            if data.bubble_peak_terrain is not None
            else None
        ),
        "camera_min_terrain": (
            [round(float(v), 2) for v in data.camera_min_terrain]
            if data.camera_min_terrain is not None
            else None
        ),
    }
