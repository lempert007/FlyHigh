"""
GET /settings  — returns the global application settings.
PUT /settings  — overwrites the global application settings.

Settings are stored in MISSIONS_ROOT/settings.json.
If that file does not exist, built-in defaults are returned without writing.
"""

from __future__ import annotations

import json
import logging

from fastapi import APIRouter

from config import MISSIONS_ROOT
from models import AppSettings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/settings", tags=["settings"])

_SETTINGS_FILE = MISSIONS_ROOT / "settings.json"


def load_settings() -> AppSettings:
    """Return settings from disk, or built-in defaults if no file exists."""
    if not _SETTINGS_FILE.exists():
        return AppSettings()
    try:
        raw = json.loads(_SETTINGS_FILE.read_text(encoding="utf-8"))
        return AppSettings.model_validate(raw)
    except Exception:
        logger.warning(
            "settings.json could not be parsed — falling back to defaults", exc_info=True
        )
        return AppSettings()


@router.get("", response_model=AppSettings)
def get_settings() -> AppSettings:
    """Return the active application settings (from disk, or built-in defaults)."""
    return load_settings()


@router.put("", response_model=AppSettings)
def save_settings(settings: AppSettings) -> AppSettings:
    """Persist new application settings to disk."""
    MISSIONS_ROOT.mkdir(parents=True, exist_ok=True)
    _SETTINGS_FILE.write_text(
        json.dumps(settings.model_dump(), indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    return settings
