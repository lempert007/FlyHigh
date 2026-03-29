"""
Mission library business logic.
Handles CRUD operations for missions stored under MISSIONS_ROOT.
Each mission lives in {MISSIONS_ROOT}/{YYYY-MM-DD}_{slug}/ with a mission.json and thumbnail.png.
"""

from __future__ import annotations

import io
import json
import logging
import os
import re
import shutil
import zipfile
from datetime import UTC, date, datetime

import config

logger = logging.getLogger(__name__)

SCHEMA_VERSION = 1


def slugify(name: str) -> str:
    """Lowercase, spaces→dashes, strip non-alphanumeric/dash characters."""
    s = name.lower().strip()
    s = re.sub(r"[\s_]+", "-", s)
    s = re.sub(r"[^a-z0-9-]", "", s)
    s = re.sub(r"-{2,}", "-", s)
    return s.strip("-") or "mission"


def make_folder_name(name: str) -> str:
    return f"{date.today().isoformat()}_{slugify(name)}"


def _validate_folder(folder: str) -> None:
    """Accept only safe folder names: alphanumerics, hyphens, underscores, 1–100 chars."""
    if not folder or not re.fullmatch(r"[a-zA-Z0-9_\-]{1,100}", folder):
        raise ValueError(f"Invalid folder name: {folder!r}")


def _mission_path(folder: str) -> str:
    return os.path.join(config.MISSIONS_ROOT, folder)


def _json_path(folder: str) -> str:
    return os.path.join(_mission_path(folder), "mission.json")


def _thumbnail_path(folder: str) -> str:
    return os.path.join(_mission_path(folder), "thumbnail.png")


def _plan_meta_path(folder: str) -> str:
    return os.path.join(_mission_path(folder), "plan_meta.json")


def _plan_zip_path(folder: str) -> str:
    return os.path.join(_mission_path(folder), "plan.zip")


def list_missions() -> list[dict]:
    """Return all missions sorted by updated_at descending."""
    results: list[dict] = []
    try:
        entries = os.listdir(config.MISSIONS_ROOT)
    except OSError:
        return results

    for entry in entries:
        folder_path = os.path.join(config.MISSIONS_ROOT, entry)
        if not os.path.isdir(folder_path):
            continue
        json_file = os.path.join(folder_path, "mission.json")
        if not os.path.isfile(json_file):
            continue
        try:
            with open(json_file, encoding="utf-8") as f:
                data = json.load(f)
            route = data.get("route", {})
            start = route.get("start")
            wps = [
                {"lat": w["lat"], "lon": w["lon"]}
                for w in route.get("waypoints", [])
                if isinstance(w, dict) and "lat" in w
            ]
            pois = [
                {"lat": p["point"]["lat"], "lon": p["point"]["lon"]}
                for p in route.get("pois", [])
                if isinstance(p, dict) and isinstance(p.get("point"), dict)
            ]
            results.append(
                {
                    "folder": entry,
                    "name": data.get("name", entry),
                    "status": data.get("status", "draft"),
                    "created_at": data.get("created_at", ""),
                    "updated_at": data.get("updated_at", ""),
                    "has_thumbnail": os.path.isfile(os.path.join(folder_path, "thumbnail.png")),
                    "route_preview": {"start": start, "waypoints": wps, "pois": pois},
                }
            )
        except (OSError, json.JSONDecodeError, KeyError, ValueError):
            logger.warning("Failed to read mission %r — skipping", entry)

    results.sort(key=lambda m: m.get("updated_at", ""), reverse=True)
    return results


def load_mission(folder: str) -> dict:
    """Load and return a mission's full JSON. Raises FileNotFoundError if absent."""
    _validate_folder(folder)
    path = _json_path(folder)
    if not os.path.isfile(path):
        raise FileNotFoundError(f"Mission {folder!r} not found")
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def save_mission(folder: str, data: dict) -> None:
    """Atomically write mission.json, then generate thumbnail non-blocking."""
    _validate_folder(folder)
    mission_dir = _mission_path(folder)
    os.makedirs(mission_dir, exist_ok=True)

    data["updated_at"] = datetime.now(UTC).isoformat()
    data["schema_version"] = SCHEMA_VERSION

    tmp_path = _json_path(folder) + ".tmp"
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    os.replace(tmp_path, _json_path(folder))

    generate_thumbnail(folder, data)


def create_mission(name: str) -> str:
    """Create a new mission folder with a minimal mission.json. Returns the folder name."""
    folder = make_folder_name(name)
    mission_dir = _mission_path(folder)

    # Avoid collision by appending a counter
    if os.path.exists(mission_dir):
        counter = 2
        while os.path.exists(f"{mission_dir}-{counter}"):
            counter += 1
        folder = f"{folder}-{counter}"
        mission_dir = _mission_path(folder)

    os.makedirs(mission_dir, exist_ok=True)
    now = datetime.now(UTC).isoformat()
    data = {
        "schema_version": SCHEMA_VERSION,
        "name": name,
        "status": "draft",
        "created_at": now,
        "updated_at": now,
        "notes": "",
        "tiff_selections": [],
        "route": {
            "start": None,
            "waypoints": [],
            "pois": [],
            "flightConfig": {},
            "takeoffMode": "auto",
            "takeoffAltM": 50,
        },
    }
    with open(_json_path(folder), "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)

    return folder


def delete_mission(folder: str) -> None:
    """Remove the mission folder and all its contents."""
    _validate_folder(folder)
    mission_dir = _mission_path(folder)
    if not os.path.isdir(mission_dir):
        raise FileNotFoundError(f"Mission {folder!r} not found")
    shutil.rmtree(mission_dir)


def save_plan(folder: str, zip_bytes: bytes) -> None:
    """Persist plan output: write plan.zip and extract plan_meta.json."""
    _validate_folder(folder)
    mission_dir = _mission_path(folder)
    if not os.path.isdir(mission_dir):
        raise FileNotFoundError(f"Mission {folder!r} not found")
    try:
        with zipfile.ZipFile(io.BytesIO(zip_bytes), "r") as zf:
            if "meta.json" in zf.namelist():
                with open(_plan_meta_path(folder), "wb") as f:
                    f.write(zf.read("meta.json"))
    except Exception:
        logger.warning("Could not extract meta.json from plan ZIP for %r", folder)
    with open(_plan_zip_path(folder), "wb") as f:
        f.write(zip_bytes)


def load_plan_meta(folder: str) -> dict | None:
    """Return parsed plan_meta.json if present, else None."""
    path = _plan_meta_path(folder)
    if not os.path.isfile(path):
        return None
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def generate_thumbnail(folder: str, data: dict) -> None:
    """
    Render a simple 200×200 PNG thumbnail from waypoint coordinates.
    Failures are logged and never propagated — saving must never block on this.
    """
    try:
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt

        route = data.get("route", {})
        start = route.get("start")
        waypoints = route.get("waypoints", [])
        pois = route.get("pois", [])

        fig, ax = plt.subplots(figsize=(2, 2), dpi=100)
        ax.set_aspect("equal")
        ax.axis("off")
        fig.patch.set_facecolor("#1a1a2e")

        # Collect all coordinates for auto-scaling
        lats, lons = [], []
        if start and isinstance(start, dict):
            lats.append(start.get("lat", 0))
            lons.append(start.get("lon", 0))
        for wp in waypoints:
            if isinstance(wp, dict):
                lats.append(wp.get("lat", 0))
                lons.append(wp.get("lon", 0))
        for poi in pois:
            p = poi.get("point", poi) if isinstance(poi, dict) else None
            if p and isinstance(p, dict):
                lats.append(p.get("lat", 0))
                lons.append(p.get("lon", 0))

        if lats and lons:
            lat_min, lat_max = min(lats), max(lats)
            lon_min, lon_max = min(lons), max(lons)
            pad_lat = max((lat_max - lat_min) * 0.15, 0.001)
            pad_lon = max((lon_max - lon_min) * 0.15, 0.001)
            ax.set_xlim(lon_min - pad_lon, lon_max + pad_lon)
            ax.set_ylim(lat_min - pad_lat, lat_max + pad_lat)

            # Draw waypoint path
            if len(waypoints) >= 2:
                wp_lons = [wp.get("lon", 0) for wp in waypoints if isinstance(wp, dict)]
                wp_lats = [wp.get("lat", 0) for wp in waypoints if isinstance(wp, dict)]
                ax.plot(wp_lons, wp_lats, color="#4fc3f7", linewidth=1.0, alpha=0.7)

            # Draw waypoints
            for wp in waypoints:
                if isinstance(wp, dict):
                    ax.plot(wp.get("lon", 0), wp.get("lat", 0), "o", color="#4fc3f7", markersize=3)

            # Draw POIs
            for poi in pois:
                p = poi.get("point", poi) if isinstance(poi, dict) else None
                if p and isinstance(p, dict):
                    ax.plot(p.get("lon", 0), p.get("lat", 0), "s", color="#ff9800", markersize=4)

            # Draw start
            if start and isinstance(start, dict):
                ax.plot(
                    start.get("lon", 0), start.get("lat", 0), "*", color="#ef5350", markersize=8
                )
        else:
            # Empty mission: show a placeholder icon
            ax.text(
                0.5,
                0.5,
                "✈",
                transform=ax.transAxes,
                ha="center",
                va="center",
                fontsize=40,
                color="#4fc3f7",
            )

        plt.tight_layout(pad=0)
        fig.savefig(
            _thumbnail_path(folder), dpi=100, bbox_inches="tight", facecolor=fig.get_facecolor()
        )
        plt.close(fig)
    except Exception:
        logger.warning("Thumbnail generation failed for %r", folder, exc_info=True)
