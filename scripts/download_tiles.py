"""
Offline tile downloader for FlyHigh.

Downloads OpenStreetMap raster tiles into backend/maps/tiles.mbtiles
(SQLite / MBTiles format) so the app can run without internet access.

Run ONCE while connected to the internet:

    python scripts/download_tiles.py --bbox 51.4 -0.2 51.6 0.0
    python scripts/download_tiles.py --bbox 51.4 -0.2 51.6 0.0 --zoom 0-16

Arguments
---------
--bbox   lat_min lon_min lat_max lon_max   Bounding box to download
--zoom   MIN-MAX                           Zoom range (default: 0-14)
--out    PATH                              Output .mbtiles path
                                           (default: backend/maps/tiles.mbtiles)

Tile counts by zoom level (for a 1°×1° area):
  zoom 0-8  :    ~400 tiles   (fast, low detail)
  zoom 0-12 :   ~6 500 tiles  (good for overview)
  zoom 0-14 :  ~26 000 tiles  (recommended for mission planning)
  zoom 0-16 : ~100 000 tiles  (high detail, slow to download)

OSM tile usage policy: https://operations.osmfoundation.org/policies/tiles/
  - Rate limited to 1 request/second
  - User-Agent identifying the application
  - Only download the tiles you need
"""

from __future__ import annotations

import argparse
import math
import sqlite3
import sys
import time
import urllib.request
from pathlib import Path

_USER_AGENT = "FlyHigh-offline-tile-downloader/1.0"
_OSM_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
_RATE_LIMIT_S = 1.0  # seconds between requests (OSM policy)

_DEFAULT_OUT = Path(__file__).parent.parent / "backend" / "maps" / "tiles.mbtiles"


# ---------------------------------------------------------------------------
# Tile math
# ---------------------------------------------------------------------------

def _deg_to_tile(lat: float, lon: float, zoom: int) -> tuple[int, int]:
    """Convert lat/lon (degrees) to tile x, y at the given zoom."""
    n = 2**zoom
    x = int((lon + 180) / 360 * n)
    lat_r = math.radians(lat)
    y = int((1 - math.log(math.tan(lat_r) + 1 / math.cos(lat_r)) / math.pi) / 2 * n)
    return x, y


def _tiles_for_bbox(
    lat_min: float, lon_min: float, lat_max: float, lon_max: float, zoom: int
) -> list[tuple[int, int, int]]:
    """Return all (z, x, y) tiles covering the bounding box at this zoom."""
    x0, y1 = _deg_to_tile(lat_max, lon_min, zoom)  # top-left  (y decreases northward)
    x1, y0 = _deg_to_tile(lat_min, lon_max, zoom)  # bottom-right
    x0, x1 = sorted([x0, x1])
    y0, y1 = sorted([y0, y1])
    return [
        (zoom, x, y)
        for x in range(x0, x1 + 1)
        for y in range(y0, y1 + 1)
    ]


# ---------------------------------------------------------------------------
# MBTiles helpers
# ---------------------------------------------------------------------------

def _init_db(conn: sqlite3.Connection) -> None:
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS metadata (
            name  TEXT,
            value TEXT
        );
        CREATE TABLE IF NOT EXISTS tiles (
            zoom_level  INTEGER,
            tile_column INTEGER,
            tile_row    INTEGER,
            tile_data   BLOB,
            PRIMARY KEY (zoom_level, tile_column, tile_row)
        );
    """)
    # Minimal required MBTiles metadata
    for name, value in [
        ("name",    "FlyHigh offline tiles"),
        ("type",    "baselayer"),
        ("version", "1"),
        ("format",  "png"),
    ]:
        conn.execute(
            "INSERT OR IGNORE INTO metadata(name, value) VALUES (?, ?)", (name, value)
        )
    conn.commit()


def _tile_exists(conn: sqlite3.Connection, z: int, x: int, y_tms: int) -> bool:
    row = conn.execute(
        "SELECT 1 FROM tiles WHERE zoom_level=? AND tile_column=? AND tile_row=?",
        (z, x, y_tms),
    ).fetchone()
    return row is not None


def _store_tile(conn: sqlite3.Connection, z: int, x: int, y_tms: int, data: bytes) -> None:
    conn.execute(
        "INSERT OR REPLACE INTO tiles(zoom_level, tile_column, tile_row, tile_data)"
        " VALUES (?, ?, ?, ?)",
        (z, x, y_tms, data),
    )


# ---------------------------------------------------------------------------
# Download
# ---------------------------------------------------------------------------

def _fetch_tile(z: int, x: int, y: int) -> bytes | None:
    url = _OSM_URL.format(z=z, x=x, y=y)
    req = urllib.request.Request(url, headers={"User-Agent": _USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.read()
    except Exception as exc:
        print(f"  WARNING: failed to fetch {url}: {exc}", file=sys.stderr)
        return None


def download(
    lat_min: float,
    lon_min: float,
    lat_max: float,
    lon_max: float,
    zoom_min: int,
    zoom_max: int,
    out_path: Path,
) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)

    # Count total tiles first so we can warn about large downloads
    all_tiles: list[tuple[int, int, int]] = []
    for z in range(zoom_min, zoom_max + 1):
        all_tiles.extend(_tiles_for_bbox(lat_min, lon_min, lat_max, lon_max, z))

    total = len(all_tiles)
    print(f"Bounding box : {lat_min},{lon_min} → {lat_max},{lon_max}")
    print(f"Zoom range   : {zoom_min}–{zoom_max}")
    print(f"Total tiles  : {total:,}")

    if total > 50_000:
        print(
            f"\nWARNING: {total:,} tiles is a large download.\n"
            "  Consider reducing the zoom range (e.g. --zoom 0-12) or a smaller bbox.\n"
            "  Estimated download time at 1 req/s: "
            f"~{total // 60} minutes.\n"
        )
        answer = input("Continue? [y/N] ").strip().lower()
        if answer != "y":
            print("Aborted.")
            return

    with sqlite3.connect(out_path) as conn:
        _init_db(conn)

        done = 0
        skipped = 0
        for z, x, y in all_tiles:
            y_tms = (2**z - 1) - y  # XYZ → TMS

            if _tile_exists(conn, z, x, y_tms):
                skipped += 1
                done += 1
                continue

            data = _fetch_tile(z, x, y)
            if data:
                _store_tile(conn, z, x, y_tms, data)
                conn.commit()

            done += 1
            pct = done / total * 100
            print(f"\r  {done:,}/{total:,} ({pct:.1f}%)  z={z} x={x} y={y}  skip={skipped}", end="", flush=True)

            time.sleep(_RATE_LIMIT_S)

    print(f"\n\nDone. Tiles saved to: {out_path}")
    print(f"  Downloaded : {done - skipped:,}")
    print(f"  Skipped    : {skipped:,} (already cached)")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _parse_zoom(s: str) -> tuple[int, int]:
    if "-" in s:
        lo, hi = s.split("-", 1)
        return int(lo), int(hi)
    z = int(s)
    return z, z


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Download OSM tiles into an MBTiles file for offline use."
    )
    parser.add_argument(
        "--bbox",
        nargs=4,
        metavar=("LAT_MIN", "LON_MIN", "LAT_MAX", "LON_MAX"),
        required=True,
        type=float,
        help="Bounding box to download",
    )
    parser.add_argument(
        "--zoom",
        default="0-14",
        help="Zoom range, e.g. 0-14 (default: 0-14)",
    )
    parser.add_argument(
        "--out",
        default=str(_DEFAULT_OUT),
        help=f"Output MBTiles path (default: {_DEFAULT_OUT})",
    )
    args = parser.parse_args()

    lat_min, lon_min, lat_max, lon_max = args.bbox
    zoom_min, zoom_max = _parse_zoom(args.zoom)

    if lat_min > lat_max or lon_min > lon_max:
        parser.error("bbox: lat_min must be ≤ lat_max and lon_min must be ≤ lon_max")
    if zoom_min < 0 or zoom_max > 19:
        parser.error("zoom must be between 0 and 19")

    download(lat_min, lon_min, lat_max, lon_max, zoom_min, zoom_max, Path(args.out))


if __name__ == "__main__":
    main()
