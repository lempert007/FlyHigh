"""
Thread-safe in-memory session store.

Each session holds the open rasterio DatasetReader objects uploaded by the client
plus the inferred FileInfo metadata. Sessions are pruned when they exceed
SESSION_TTL_SECONDS to avoid file-descriptor and memory leaks.
"""

from __future__ import annotations

import logging
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

import numpy as np

import config
from models import FileInfo, FlightConfig, PlanMeta, POIConfig

if TYPE_CHECKING:
    import rasterio

logger = logging.getLogger(__name__)

# ── Data structures ───────────────────────────────────────────────────────────


@dataclass
class SessionFile:
    dataset: rasterio.DatasetReader
    info: FileInfo


@dataclass
class LastPlanData:
    """All arrays and metadata needed to generate a PDF report without re-planning."""

    lats: np.ndarray
    lons: np.ndarray
    final_alts: np.ndarray
    terrain_elevs: np.ndarray
    agl_arr: np.ndarray
    cum_dists: np.ndarray
    start_index: int
    landing_index: int
    poi_indices: list[int]
    waypoint_indices: list[int]
    poi_distances: list[float]
    pois: list[POIConfig]
    meta: PlanMeta
    fc: FlightConfig
    route_hash: str
    mission_name: str
    zone_str: str
    generated_at: str  # ISO UTC timestamp
    terrain_grid: np.ndarray | None  # (G, G) elevation MSL
    terrain_grid_lons: np.ndarray | None  # (G,) longitude coords
    terrain_grid_lats: np.ndarray | None  # (G,) latitude coords
    waypoints_list: list[dict] | None = None  # waypoint dicts (updated after altitude edits)
    no_terrain_mask: np.ndarray | None = None  # True where terrain data was NaN (skip safety check)
    zip_bytes: bytes | None = None  # full plan ZIP for patching on altitude edit
    poi_bands_list: list[dict] | None = None  # POI AGL band overrides for the altitude editor
    bubble_peak_terrain: np.ndarray | None = None  # peak terrain in safety disc at each route point
    camera_min_terrain: np.ndarray | None = None  # min terrain in camera disc at each route point


@dataclass
class SessionData:
    files: dict[str, SessionFile] = field(default_factory=dict)
    last_plan: LastPlanData | None = None
    created_at: float = field(default_factory=time.time)


# ── Store ─────────────────────────────────────────────────────────────────────

_store: dict[str, SessionData] = {}
_lock: threading.Lock = threading.Lock()


def create_session() -> str:
    """Create an empty session and return its UUID string.

    If the store is at capacity (MAX_SESSIONS), the oldest session is evicted
    before the new one is inserted.
    """
    session_id = str(uuid.uuid4())
    evicted: SessionData | None = None
    with _lock:
        if len(_store) >= config.MAX_SESSIONS:
            oldest_sid = min(_store, key=lambda s: _store[s].created_at)
            evicted = _store.pop(oldest_sid)
            logger.warning("Session cap reached — evicted oldest session %s", oldest_sid)
        _store[session_id] = SessionData()
    if evicted is not None:
        for sf in evicted.files.values():
            try:
                sf.dataset.close()
            except Exception as exc:
                logger.warning("Failed to close evicted dataset: %s", exc)
    return session_id


def store_file(session_id: str, name: str, dataset: rasterio.DatasetReader, info: FileInfo) -> None:
    """Add an open rasterio dataset to an existing session."""
    with _lock:
        if session_id not in _store:
            raise KeyError(f"Session {session_id!r} not found")
        _store[session_id].files[name] = SessionFile(dataset=dataset, info=info)


def get_session(session_id: str) -> SessionData | None:
    """Return the session data or None if it does not exist."""
    with _lock:
        return _store.get(session_id)


def store_plan_data(session_id: str, data: LastPlanData) -> None:
    """Attach the result of the most recent plan to the session for PDF generation."""
    with _lock:
        s = _store.get(session_id)
        if s is not None:
            s.last_plan = data


def get_plan_data(session_id: str) -> LastPlanData | None:
    """Return the most recent plan data for a session, or None."""
    with _lock:
        s = _store.get(session_id)
        return s.last_plan if s is not None else None


def delete_session(session_id: str) -> None:
    """Close all datasets in a session and remove it from the store."""
    with _lock:
        session = _store.pop(session_id, None)
    if session is not None:
        for sf in session.files.values():
            try:
                sf.dataset.close()
            except Exception as exc:
                logger.warning("Failed to close dataset: %s", exc)


def prune_expired_sessions() -> int:
    """Close and remove sessions older than SESSION_TTL_SECONDS. Returns count pruned."""
    cutoff = time.time() - config.SESSION_TTL_SECONDS
    evicted: list[tuple[str, SessionData]] = []
    with _lock:
        for sid, data in list(_store.items()):
            if data.created_at < cutoff:
                evicted.append((sid, _store.pop(sid)))

    # Close datasets outside the lock to avoid holding it during I/O
    for sid, session in evicted:
        logger.info("Pruning expired session %s", sid)
        for sf in session.files.values():
            try:
                sf.dataset.close()
            except Exception as exc:
                logger.warning("Failed to close dataset for session %s: %s", sid, exc)

    return len(evicted)
