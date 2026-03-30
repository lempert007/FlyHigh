"""
Local MBTiles tile server.

Serves raster PNG tiles from backend/maps/tiles.mbtiles (SQLite).
Returns HTTP 204 (no content) when the file is absent so Leaflet
renders a blank tile rather than showing broken-image errors.

Populate the MBTiles file while online:
    python scripts/download_tiles.py --bbox <lat_min lon_min lat_max lon_max>
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import Response

router = APIRouter()

_MBTILES = Path(__file__).parent.parent / "maps" / "tiles.mbtiles"
_NO_TILE = Response(status_code=204)  # blank — don't show a broken-image icon


@router.get("/tiles/{z}/{x}/{y}.png")
async def get_tile(z: int, x: int, y: int) -> Response:
    if not _MBTILES.exists():
        return _NO_TILE

    # MBTiles stores tiles in TMS convention where the y-axis is inverted
    y_tms = (2**z - 1) - y

    with sqlite3.connect(_MBTILES) as conn:
        row = conn.execute(
            "SELECT tile_data FROM tiles"
            " WHERE zoom_level = ? AND tile_column = ? AND tile_row = ?",
            (z, x, y_tms),
        ).fetchone()

    if row is None:
        return _NO_TILE

    return Response(
        content=row[0],
        media_type="image/png",
        headers={"Cache-Control": "max-age=86400, immutable"},
    )
