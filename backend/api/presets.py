"""
GET /presets  — returns the global drone preset list.
PUT /presets  — overwrites the global drone preset list.

Presets are stored in MISSIONS_ROOT/presets.json.
If that file does not exist, the built-in defaults are returned without writing.
"""

from __future__ import annotations

import json
import logging

from fastapi import APIRouter, HTTPException

from config import MISSIONS_ROOT
from models import PresetItem

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/presets", tags=["presets"])

# Built-in defaults — mirrors the hardcoded values in frontend/src/dronePresets.ts.
BUILTIN_PRESETS: list[PresetItem] = [
    PresetItem(name="Drone 1",      cruise_speed_ms=10, climb_rate_ms=3, battery_wh=600,  drone_weight_kg=6.0),
    PresetItem(name="Drone 2",      cruise_speed_ms=15, climb_rate_ms=6, battery_wh=1550, drone_weight_kg=2.5),
    PresetItem(name="Fixed Wing 1", cruise_speed_ms=25, climb_rate_ms=4, battery_wh=300,  drone_weight_kg=1.5),
]

_PRESETS_FILE = MISSIONS_ROOT / "presets.json"


def _load_from_disk() -> list[PresetItem] | None:
    """Return presets from disk, or None if the file does not exist."""
    if not _PRESETS_FILE.exists():
        return None
    try:
        raw = json.loads(_PRESETS_FILE.read_text(encoding="utf-8"))
        return [PresetItem.model_validate(item) for item in raw]
    except Exception:
        logger.warning("presets.json could not be parsed — falling back to built-ins", exc_info=True)
        return None


def _validate_preset_list(presets: list[PresetItem]) -> None:
    """Raise HTTPException 422 if the list violates invariants."""
    if len(presets) == 0:
        raise HTTPException(status_code=422, detail="At least one preset is required.")
    names = [p.name.strip().lower() for p in presets]
    if len(names) != len(set(names)):
        raise HTTPException(status_code=422, detail="Preset names must be unique.")


@router.get("", response_model=list[PresetItem])
def get_presets() -> list[PresetItem]:
    """Return the active preset list (from disk, or built-in defaults)."""
    from_disk = _load_from_disk()
    return from_disk if from_disk is not None else BUILTIN_PRESETS


@router.get("/is-customised", response_model=bool)
def is_customised() -> bool:
    """Return True if the user has saved a custom presets.json (not just built-ins)."""
    return _PRESETS_FILE.exists()


@router.put("", response_model=list[PresetItem])
def save_presets(presets: list[PresetItem]) -> list[PresetItem]:
    """Persist a new preset list to disk."""
    _validate_preset_list(presets)
    MISSIONS_ROOT.mkdir(parents=True, exist_ok=True)
    _PRESETS_FILE.write_text(
        json.dumps([p.model_dump() for p in presets], indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    return presets
