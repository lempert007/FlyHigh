"""
GET /plan/{session_id}/editor-data

Returns the data needed by the interactive altitude editor as JSON.
Reads directly from session state so it always reflects the latest
altitude edits — no need for the frontend to parse the download ZIP.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

import session as session_store
from core.types import POI_SCAN_ACTIONS, Action
from models import SegmentType

router = APIRouter(prefix="/plan", tags=["editor-data"])


def _build_profile_points(
    waypoints_list: list[dict],
    cum_dists: list[float],
    poi_indices: list[int],
    waypoint_indices: list[int],
) -> list[dict]:
    """Compute per-waypoint segment metadata for the altitude editor chart."""
    poi_starts = sorted(poi_indices)
    wp_index_map = {idx: j for j, idx in enumerate(waypoint_indices)}

    result: list[dict] = []
    for i, wp in enumerate(waypoints_list):
        action = wp.get("action", "")
        dist_m = round(float(cum_dists[i]), 2) if i < len(cum_dists) else 0.0

        if action in POI_SCAN_ACTIONS:
            # Find the last POI block that started at or before this index
            poi_id: int | None = None
            for j, start in enumerate(poi_starts):
                if i >= start:
                    poi_id = j
            result.append(
                {
                    "dist_m": dist_m,
                    "segment_type": SegmentType.POI_SCAN,
                    "poi_id": poi_id,
                    "waypoint_id": None,
                }
            )
        elif action == Action.WAYPOINT:
            waypoint_id = wp_index_map.get(i)
            result.append(
                {
                    "dist_m": dist_m,
                    "segment_type": SegmentType.WAYPOINT,
                    "poi_id": None,
                    "waypoint_id": waypoint_id,
                }
            )
        else:
            result.append(
                {
                    "dist_m": dist_m,
                    "segment_type": SegmentType.TRANSIT,
                    "poi_id": None,
                    "waypoint_id": None,
                }
            )

    return result


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

    profile_points = _build_profile_points(
        data.waypoints_list,
        data.cum_dists.tolist(),
        data.poi_indices,
        data.waypoint_indices,
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
        "profile_points": profile_points,
    }
