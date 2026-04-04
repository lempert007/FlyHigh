"""
Stateless preview endpoint for smart lawnmower strip spacing.
No session / terrain data required — pure geometry.
"""

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

import config
from core.poi import compute_overlap_spacing, compute_precise_spacing

router = APIRouter()


class StripSpacingPreview(BaseModel):
    precise_spacing_m: float
    overlap_spacing_m: float
    estimated_strips: int | None
    warning: str | None


@router.get("/preview-strip-spacing", response_model=StripSpacingPreview)
def preview_strip_spacing(
    alt_agl: float = Query(..., gt=0, description="Drone altitude AGL in metres"),
    fov_deg: float = Query(..., gt=0, lt=180, description="Camera horizontal FOV in degrees"),
    overlap: float = Query(..., ge=0.0, description="Strip overlap fraction [0, 0.8)"),
    area_width_m: float | None = Query(
        default=None, gt=0, description="Cross-track area width in metres (optional)"
    ),
) -> StripSpacingPreview:
    if overlap >= config.SMART_LAWNMOWER_MAX_OVERLAP:
        raise HTTPException(
            status_code=422,
            detail=f"overlap must be < {config.SMART_LAWNMOWER_MAX_OVERLAP}",
        )

    precise_spacing = compute_precise_spacing(alt_agl, fov_deg)
    raw_overlap_spacing = compute_overlap_spacing(precise_spacing, overlap)

    warning: str | None = None
    overlap_spacing = raw_overlap_spacing
    if raw_overlap_spacing < config.SMART_LAWNMOWER_MIN_SPACING_M:
        overlap_spacing = config.SMART_LAWNMOWER_MIN_SPACING_M
        warning = (
            f"Computed overlap spacing {raw_overlap_spacing:.2f} m is below minimum "
            f"{config.SMART_LAWNMOWER_MIN_SPACING_M:.1f} m — clamped."
        )

    estimated_strips: int | None = None
    if area_width_m is not None:
        estimated_strips = max(1, round(area_width_m / overlap_spacing))

    return StripSpacingPreview(
        precise_spacing_m=round(precise_spacing, 2),
        overlap_spacing_m=round(overlap_spacing, 2),
        estimated_strips=estimated_strips,
        warning=warning,
    )
