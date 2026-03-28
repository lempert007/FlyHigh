"""
Package all output files into an in-memory ZIP archive.
"""

from __future__ import annotations

import io
import zipfile

# Files that are internal to the altitude editor and should not appear in the
# user-facing download ZIP.
_INTERNAL_FILES = frozenset({"poi_bands.json", "waypoint_indices.json"})


def build_zip(
    waypoints_json_str: str,
    combined_html: str,
    mission_log: str,
    kml_str: str | None = None,
    agl_profile_json: str | None = None,
    poi_bands_json: str | None = None,
    waypoint_indices_json: str | None = None,
    meta_json: str | None = None,
) -> io.BytesIO:
    """Create an in-memory ZIP containing the mission output files.

    Files included:
      - waypoints.json       — drone waypoint sequence
      - mission_report.html  — tabbed HTML with map, 3D view, altitude profile
      - mission_log.txt      — plain-text log with stats and violation details
      - meta.json            — plan metadata (flight stats, violations) for the frontend
      - waypoints.kml        — KML for Google Earth / DJI (if kml_str is provided)
      - agl_profile.json     — per-waypoint AGL clearance values for map coloring
      - poi_bands.json        — per-POI AGL band overrides for altitude editor (internal)
      - waypoint_indices.json — waypoint index map for altitude editor (internal)

    Returns a seeked-to-start BytesIO buffer ready for streaming.
    """
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("waypoints.json", waypoints_json_str.encode("utf-8"))
        zf.writestr("mission_report.html", combined_html.encode("utf-8"))
        zf.writestr("mission_log.txt", mission_log.encode("utf-8"))
        if meta_json is not None:
            zf.writestr("meta.json", meta_json.encode("utf-8"))
        if kml_str is not None:
            zf.writestr("waypoints.kml", kml_str.encode("utf-8"))
        if agl_profile_json is not None:
            zf.writestr("agl_profile.json", agl_profile_json.encode("utf-8"))
        if poi_bands_json is not None:
            zf.writestr("poi_bands.json", poi_bands_json.encode("utf-8"))
        if waypoint_indices_json is not None:
            zf.writestr("waypoint_indices.json", waypoint_indices_json.encode("utf-8"))
    buf.seek(0)
    return buf


def strip_internal_files(zip_bytes: bytes) -> bytes:
    """Return a copy of zip_bytes with internal editor files removed."""
    out = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(zip_bytes), "r") as src, \
         zipfile.ZipFile(out, mode="w", compression=zipfile.ZIP_DEFLATED) as dst:
        for name in src.namelist():
            if name not in _INTERNAL_FILES:
                dst.writestr(name, src.read(name))
    return out.getvalue()
