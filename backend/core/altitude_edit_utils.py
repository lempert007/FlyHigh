"""
Shared logic for applying manual altitude overrides to a saved plan ZIP.

Used by both the session-based endpoint (api/altitude_edit.py) and the
folder-based endpoint (api/missions.py) so the patching logic lives in one place.
"""

from __future__ import annotations

import io
import json
import zipfile

import numpy as np

from export.render_kml import render_kml
from export.waypoints import serialise_waypoints_json
from models import PlanMeta, ViolationInfo


def patch_plan_zip(
    zip_bytes: bytes,
    alt_overrides: list[float],
    terrain_elevs: np.ndarray,
    min_agl_m: float,
    max_agl_m: float | None,
    lats: np.ndarray,
    lons: np.ndarray,
    original_meta: PlanMeta,
) -> tuple[bytes, PlanMeta]:
    """
    Apply altitude overrides to waypoints inside a plan ZIP.

    Returns (patched_zip_bytes, updated_meta) with refreshed violations and
    clearance statistics. Raises ValueError if alt_overrides length doesn't
    match the waypoint count.
    """
    with zipfile.ZipFile(io.BytesIO(zip_bytes), "r") as zf:
        wps: list[dict] = json.loads(zf.read("waypoints.json"))

    n = len(wps)
    if len(alt_overrides) != n:
        raise ValueError(f"Expected {n} altitude values, got {len(alt_overrides)}.")

    new_alts = np.array(alt_overrides, dtype=float)
    new_agl = new_alts - terrain_elevs

    # AGL safety check
    violations: list[ViolationInfo] = []
    for i in range(n):
        agl = float(new_agl[i])
        if agl < min_agl_m:
            violations.append(
                ViolationInfo(
                    point_index=i,
                    kind="terrain_band",
                    category="safety",
                    description=f"Below minimum AGL: {agl:.1f} m (min {min_agl_m:.1f} m)",
                    lat=float(lats[i]),
                    lon=float(lons[i]),
                )
            )
        elif max_agl_m is not None and agl > max_agl_m:
            violations.append(
                ViolationInfo(
                    point_index=i,
                    kind="surface_warning",
                    category="product_route",
                    description=f"Above maximum AGL: {agl:.1f} m (max {max_agl_m:.1f} m)",
                    lat=float(lats[i]),
                    lon=float(lons[i]),
                )
            )

    updated_meta = original_meta.model_copy(
        update={
            "violations": violations,
            "min_clearance_m": round(float(np.min(new_agl)), 1) if n > 0 else None,
            "mean_clearance_m": round(float(np.mean(new_agl)), 1) if n > 0 else None,
            "tight_segment_count": int(np.sum(new_agl < min_agl_m * 1.2)) if n > 0 else None,
        }
    )

    updated_wps = [{**wp, "alt_m": round(float(a), 2)} for wp, a in zip(wps, new_alts)]
    agl_json = json.dumps([round(float(v), 2) for v in new_agl])

    patched = {"waypoints.json", "waypoints.kml", "agl_profile.json", "meta.json"}
    buf = io.BytesIO()
    with (
        zipfile.ZipFile(io.BytesIO(zip_bytes), "r") as src,
        zipfile.ZipFile(buf, mode="w", compression=zipfile.ZIP_DEFLATED) as dst,
    ):
        for name in src.namelist():
            if name not in patched:
                dst.writestr(name, src.read(name))
        dst.writestr("waypoints.json", serialise_waypoints_json(updated_wps).encode())
        dst.writestr("waypoints.kml", render_kml(updated_wps).encode())
        dst.writestr("agl_profile.json", agl_json.encode())
        dst.writestr("meta.json", updated_meta.model_dump_json().encode())

    return buf.getvalue(), updated_meta
