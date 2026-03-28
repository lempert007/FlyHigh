"""PDF mission report endpoint."""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

import session as session_store
from export.render_pdf import generate_pdf

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/plan", tags=["pdf"])


class PdfReportRequest(BaseModel):
    operator_name: str = ""
    organization: str = ""


@router.post("/{session_id}/pdf")
async def generate_pdf_report(
    session_id: str,
    body: PdfReportRequest,
) -> Response:
    """Generate and return a PDF mission report for the most recently planned route."""
    data = session_store.get_plan_data(session_id)
    if data is None:
        raise HTTPException(
            status_code=404,
            detail="No plan found for this session. Plan a route first.",
        )

    try:
        pdf_bytes = generate_pdf(data, body.operator_name, body.organization)
    except Exception as exc:
        logger.exception("PDF generation failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"PDF generation failed: {exc}") from exc

    filename = f"flyhigh_report_{data.route_hash[:8]}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
