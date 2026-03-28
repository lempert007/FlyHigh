"""
GET /dashboard/stats — aggregated analytics across all saved missions.

All computation is done server-side by reading every mission.json.
Errors reading individual files are silently skipped (logged as warnings).
"""

from __future__ import annotations

import json
import logging
import math
from collections import Counter
from pathlib import Path

from fastapi import APIRouter

from config import MISSIONS_ROOT
from models import DashboardStats, MissionPin, MissionStatus, RecentMission

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


# ── Geometry helpers ──────────────────────────────────────────────────────────

_DEG_TO_M_LAT = 111_320.0  # metres per degree latitude (approx)


def _deg_to_m_lon(lat_deg: float) -> float:
    return _DEG_TO_M_LAT * math.cos(math.radians(lat_deg))


def _shoelace_area_m2(polygon: list[dict]) -> float:
    """Return signed area in m² of a lat/lon polygon using the shoelace formula
    with a mid-latitude planar approximation.  Returns 0 for degenerate inputs."""
    n = len(polygon)
    if n < 3:
        return 0.0
    lats = [p["lat"] for p in polygon]
    lons = [p["lon"] for p in polygon]
    mid_lat = sum(lats) / n
    m_per_lon = _deg_to_m_lon(mid_lat)
    xs = [lon * m_per_lon for lon in lons]
    ys = [lat * _DEG_TO_M_LAT for lat in lats]
    area = 0.0
    for i in range(n):
        j = (i + 1) % n
        area += xs[i] * ys[j]
        area -= xs[j] * ys[i]
    return abs(area) / 2.0


def _poi_area_m2(maneuver: dict) -> float:
    """Return the survey area for a single POI in m²."""
    polygon = maneuver.get("polygon")
    if polygon:
        return _shoelace_area_m2(polygon)
    width = maneuver.get("width_m", 0.0)
    height = maneuver.get("height_m", 0.0)
    return float(width) * float(height)


# ── Stats computation ─────────────────────────────────────────────────────────

def _read_all_missions() -> list[dict]:
    """Return the raw JSON dict for every readable mission.json in MISSIONS_ROOT."""
    results: list[dict] = []
    if not MISSIONS_ROOT.is_dir():
        return results
    for mission_dir in sorted(MISSIONS_ROOT.iterdir()):
        json_path = mission_dir / "mission.json"
        if not json_path.is_file():
            continue
        try:
            results.append(json.loads(json_path.read_text(encoding="utf-8")))
        except Exception:
            logger.warning("Could not read %s — skipping", json_path, exc_info=True)
    return results


def _compute_stats(missions: list[dict]) -> DashboardStats:
    status_counts: Counter[str] = Counter({"draft": 0, "ready": 0, "flown": 0})
    total_area_m2 = 0.0
    missions_with_area = 0
    total_flight_seconds = 0.0
    preset_counter: Counter[str] = Counter()
    pins: list[MissionPin] = []
    all_sorted = sorted(missions, key=lambda m: m.get("updated_at", ""), reverse=True)

    for m in missions:
        status = m.get("status", "draft")
        if status in status_counts:
            status_counts[status] += 1

        route = m.get("route") or {}
        pois = route.get("pois") or []
        flight_config = route.get("flightConfig") or {}
        cruise_speed = float(flight_config.get("cruise_speed_ms", 10.0))

        mission_area_m2 = 0.0
        for poi in pois:
            maneuver = poi.get("maneuver") or {}
            area = _poi_area_m2(maneuver)
            mission_area_m2 += area

            if area > 0:
                # Estimate flight distance: coverage area divided by sweep spacing gives
                # number of strips; multiply by representative strip length for total distance.
                sweep_spacing = max(float(maneuver.get("sweep_spacing_m", 30.0)), 1.0)
                polygon = maneuver.get("polygon")
                if polygon and len(polygon) >= 3:
                    lats = [p["lat"] for p in polygon]
                    lons = [p["lon"] for p in polygon]
                    height_m = (_deg_to_m_lon(sum(lats) / len(lats))
                                * (max(lons) - min(lons))) if len(lons) > 1 else float(maneuver.get("height_m", 100.0))
                else:
                    height_m = float(maneuver.get("height_m", 100.0))
                n_strips = area / max(sweep_spacing * height_m, 1.0)
                strip_distance = n_strips * height_m
                total_flight_seconds += strip_distance / max(cruise_speed, 0.1)

        if mission_area_m2 > 0:
            total_area_m2 += mission_area_m2
            missions_with_area += 1

        preset_name = m.get("preset_name") or route.get("preset_name")
        if preset_name:
            preset_counter[preset_name] += 1

        start = route.get("start")
        pins.append(MissionPin(
            folder=m.get("folder", ""),
            name=m.get("name", ""),
            status=MissionStatus(status) if status in ("draft", "ready", "flown") else MissionStatus.draft,
            created_at=m.get("created_at", ""),
            lat=float(start["lat"]) if start else None,
            lon=float(start["lon"]) if start else None,
        ))

    recent = [
        RecentMission(
            folder=m.get("folder", ""),
            name=m.get("name", ""),
            status=MissionStatus(m.get("status", "draft")) if m.get("status") in ("draft", "ready", "flown") else MissionStatus.draft,
            updated_at=m.get("updated_at", ""),
        )
        for m in all_sorted[:10]
    ]

    most_used = preset_counter.most_common(1)[0][0] if preset_counter else None

    return DashboardStats(
        missions_by_status=dict(status_counts),
        total_area_m2=round(total_area_m2, 2),
        missions_with_area=missions_with_area,
        estimated_flight_hours=round(total_flight_seconds / 3600.0, 2),
        most_used_preset=most_used,
        recent_activity=recent,
        mission_pins=pins,
    )


# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.get("/stats", response_model=DashboardStats)
def get_dashboard_stats() -> DashboardStats:
    """Return aggregated analytics across all saved missions."""
    return _compute_stats(_read_missions_with_folders())


def _read_missions_with_folders() -> list[dict]:
    """Return mission dicts enriched with their folder name."""
    results: list[dict] = []
    if not MISSIONS_ROOT.is_dir():
        return results
    for mission_dir in sorted(MISSIONS_ROOT.iterdir()):
        json_path = mission_dir / "mission.json"
        if not json_path.is_file():
            continue
        try:
            data = json.loads(json_path.read_text(encoding="utf-8"))
            data["folder"] = mission_dir.name
            results.append(data)
        except Exception:
            logger.warning("Could not read %s — skipping", json_path, exc_info=True)
    return results
