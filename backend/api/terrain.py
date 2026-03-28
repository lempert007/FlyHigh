"""Elevation heatmap image endpoint.

Returns a colorized PNG preview of the terrain for a given session file.
Uses only rasterio + numpy + stdlib — no new dependencies required.
"""

from __future__ import annotations

import struct
import zlib

import numpy as np
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from rasterio.enums import Resampling

from session import get_session

router = APIRouter()

_MAX_PX = 512  # max dimension of the output image

# 5-stop terrain colormap: R, G, B, A
_COLORMAP = np.array(
    [
        [70, 130, 180, 210],  # steel blue  — low / sea level
        [34, 139, 34, 210],  # forest green
        [210, 180, 140, 210],  # tan / plains
        [139, 90, 43, 210],  # sienna brown / highlands
        [255, 255, 255, 210],  # white — peaks
    ],
    dtype=np.float32,
)


def _colorize(normalized: np.ndarray) -> np.ndarray:
    """Map a 0-1 float array to RGBA uint8 via linear interpolation across colormap stops."""
    n_stops = len(_COLORMAP) - 1
    scaled = (normalized * n_stops).clip(0, n_stops)
    lo = np.floor(scaled).astype(int).clip(0, n_stops - 1)
    hi = (lo + 1).clip(0, n_stops)
    t = (scaled - lo)[..., np.newaxis]
    rgba = _COLORMAP[lo] * (1.0 - t) + _COLORMAP[hi] * t
    return rgba.astype(np.uint8)


def _encode_png(rgba: np.ndarray) -> bytes:
    """Encode an H×W×4 uint8 array as PNG using Python stdlib only."""
    h, w = rgba.shape[:2]

    def chunk(tag: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(tag + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)

    ihdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)  # 8-bit depth, RGBA colour type
    raw_rows = b"".join(b"\x00" + rgba[y].tobytes() for y in range(h))

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(raw_rows, level=6))
        + chunk(b"IEND", b"")
    )


@router.get("/elevation-point/{session_id}")
def get_elevation_point(session_id: str, lat: float, lon: float) -> dict:
    """Sample elevation at a single lat/lon coordinate from the first file in the session."""
    sess = get_session(session_id)
    if sess is None:
        raise HTTPException(status_code=404, detail="Session not found or expired")
    if not sess.files:
        raise HTTPException(status_code=404, detail="No files in session")

    ds = next(iter(sess.files.values())).dataset
    try:
        val = float(next(ds.sample([(lon, lat)]))[0])
        if ds.nodata is not None and val == ds.nodata or not (-1e6 < val < 1e6):
            val = None  # type: ignore[assignment]
    except Exception:
        val = None  # type: ignore[assignment]

    return {"elevation_m": val}


@router.get("/elevation-image/{session_id}/{filename}")
def get_elevation_image(session_id: str, filename: str) -> Response:
    """Return a colorized elevation PNG for the given file in the session."""
    sess = get_session(session_id)
    if sess is None:
        raise HTTPException(status_code=404, detail="Session not found or expired")

    sf = sess.files.get(filename)
    if sf is None:
        raise HTTPException(status_code=404, detail=f"{filename!r} not in session")

    ds = sf.dataset
    h, w = ds.height, ds.width
    scale = _MAX_PX / max(h, w, 1)
    out_h = max(1, round(h * scale))
    out_w = max(1, round(w * scale))

    # Read band 1 at the target resolution — rasterio handles downsampling natively
    band = ds.read(
        1,
        out_shape=(out_h, out_w),
        resampling=Resampling.average,
    ).astype(np.float32)

    # Mask nodata
    if ds.nodata is not None:
        band[band == ds.nodata] = np.nan

    valid = band[~np.isnan(band)]
    if len(valid) == 0:
        raise HTTPException(status_code=422, detail="No valid elevation data in file")

    lo, hi = float(valid.min()), float(valid.max())
    normalized = (band - lo) / (hi - lo + 1e-9)

    rgba = _colorize(normalized.clip(0, 1))
    rgba[np.isnan(band), 3] = 0  # fully transparent nodata pixels

    return Response(
        content=_encode_png(rgba),
        media_type="image/png",
        headers={"Cache-Control": "max-age=3600"},
    )
