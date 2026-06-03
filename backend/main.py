"""
FlyHigh FastAPI application entry point.

Start with:
    uvicorn main:app --reload
"""

from __future__ import annotations

import asyncio
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import config
from api.altitude_edit import router as altitude_edit_router
from api.dashboard import router as dashboard_router
from api.editor_data import router as editor_data_router
from api.missions import router as missions_router
from api.pdf import router as pdf_router
from api.plan import router as plan_router
from api.presets import router as presets_router
from api.preview import router as preview_router
from api.settings import router as settings_router
from api.terrain import router as terrain_router
from api.tiles import router as tiles_router
from api.upload import router as upload_router
from session import prune_expired_sessions

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
)

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    async def _prune_loop():
        while True:
            await asyncio.sleep(config.SESSION_PRUNE_INTERVAL_S)
            pruned = prune_expired_sessions()
            if pruned:
                logger.info("Background prune: removed %d expired session(s)", pruned)

    task = asyncio.create_task(_prune_loop())
    try:
        yield
    finally:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass


app = FastAPI(
    title="FlyHigh",
    description="Drone mission planner — terrain-aware route optimisation API",
    version="0.1.0",
    lifespan=lifespan,
)

_cors_origins = os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Plan-Meta"],
)

app.include_router(tiles_router)
app.include_router(upload_router)
app.include_router(plan_router)
app.include_router(terrain_router)
app.include_router(pdf_router)
app.include_router(altitude_edit_router)
app.include_router(editor_data_router)
app.include_router(missions_router)
app.include_router(presets_router)
app.include_router(settings_router)
app.include_router(dashboard_router)
app.include_router(preview_router)


@app.get("/health")
def health() -> dict:
    """Simple liveness probe."""
    return {"status": "ok"}


@app.get("/system-config")
def system_config() -> dict:
    """Expose deployment-time configuration to the frontend."""
    return {
        "offline_maps": config.OFFLINE_MAPS,
        "tile_url": config.TILE_URL_OFFLINE if config.OFFLINE_MAPS else None,
    }
