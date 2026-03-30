"""
GET  /tiffs  — list available GeoTIFF files in the server-side library folder.
POST /upload — activate selected library files into a session (no file bytes from client).
"""

from __future__ import annotations

import logging
import os
import re

from fastapi import APIRouter, HTTPException

import config
import session as session_store
from core.terrain import extract_file_info, load_tiff
from models import ActivateRequest, FileInfo, UploadResponse

logger = logging.getLogger(__name__)

router = APIRouter()

# Regex matching filenames that should be classified as DSM vs DTM
_DSM_RE = re.compile(r"\bdsm\b|surface", re.IGNORECASE)
_DTM_RE = re.compile(r"\bdtm\b|terrain|bare", re.IGNORECASE)


def _infer_type(filename: str) -> str:
    """Return 'DSM', 'DTM', or 'unknown' based on filename heuristics."""
    if _DSM_RE.search(filename):
        return "DSM"
    if _DTM_RE.search(filename):
        return "DTM"
    return "unknown"


def _validate_name(name: str) -> None:
    """Reject names containing path traversal components."""
    if "/" in name or "\\" in name or ".." in name:
        raise HTTPException(status_code=422, detail=f"Invalid filename: {name!r}")
    if not (name.lower().endswith(".tif") or name.lower().endswith(".tiff")):
        raise HTTPException(
            status_code=422, detail=f"File {name!r} is not a GeoTIFF (.tif / .tiff)"
        )


@router.get("/tiffs")
async def list_tiffs() -> list[dict]:
    """Return all .tif / .tiff files available in the TIFF library folder."""
    try:
        entries = os.listdir(config.TIFF_LIBRARY_PATH)
    except OSError as exc:
        logger.error("Cannot read TIFF library at %s: %s", config.TIFF_LIBRARY_PATH, exc)
        raise HTTPException(status_code=500, detail="TIFF library is unavailable") from exc

    results = []
    for name in sorted(entries):
        if name.lower().endswith(".tif") or name.lower().endswith(".tiff"):
            results.append({"name": name, "inferred_type": _infer_type(name)})
    return results


@router.post("/upload", response_model=UploadResponse)
async def activate_tiffs(body: ActivateRequest) -> UploadResponse:
    """Open selected library files into a new session.

    No file bytes are transferred — files are opened directly from TIFF_LIBRARY_PATH.
    """
    session_store.prune_expired_sessions()

    for sel in body.selections:
        _validate_name(sel.name)

    session_id = session_store.create_session()

    try:
        file_infos: list[FileInfo] = []
        for sel in body.selections:
            path = os.path.join(config.TIFF_LIBRARY_PATH, sel.name)
            if not os.path.isfile(path):
                raise HTTPException(
                    status_code=422,
                    detail=f"File {sel.name!r} not found in TIFF library",
                )
            try:
                ds = load_tiff(path)
            except RuntimeError as exc:
                raise HTTPException(status_code=422, detail=str(exc)) from exc

            info = extract_file_info(ds, sel.type)
            info = info.model_copy(update={"name": sel.name})
            session_store.store_file(session_id, sel.name, ds, info)
            file_infos.append(info)

    except HTTPException:
        session_store.delete_session(session_id)
        raise
    except Exception as exc:
        session_store.delete_session(session_id)
        logger.exception("Unexpected error during tiff activation: %s", exc)
        raise HTTPException(
            status_code=500, detail="Internal server error during activation"
        ) from exc

    return UploadResponse(session_id=session_id, files=file_infos, notice=None)
