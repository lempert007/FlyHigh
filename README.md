# FlyHigh — Terrain-Following Drone Mission Planner

FlyHigh is a full-stack web application that plans safe, energy-efficient drone flight routes that follow the terrain. Upload elevation data, place your mission points on a map, and download a ready-to-fly waypoint file — all from a browser.

---

## Prerequisites

| Tool | Version |
|------|---------|
| Python | ≥ 3.11 |
| Node.js | ≥ 18 |
| uv | latest (`pip install uv` or `curl -LsSf https://astral.sh/uv/install.sh \| sh`) |

---

## Quick Start

```bash
# Backend
cd backend
uv sync
uvicorn main:app --reload

# Frontend (separate terminal)
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173` in your browser.

---

## How to Use It

**Step 1 — Upload Terrain**
Upload one or two GeoTIFF files. For each file, declare whether it is a DSM (surface model — includes trees and buildings) or a DTM (terrain model — bare ground). Two files give better results: the DSM is used for obstacle avoidance, the DTM for altitude planning. If you only have one file it is used for both.

**Step 2 — Place Points & Maneuvers**
Click *Start* to place your takeoff point. Optionally set a fixed takeoff altitude (MSL) or let the system derive it from the terrain. Add intermediate *Waypoints* if needed. Add *POIs* (Points of Interest) — each gets a maneuver type:
- **Lawnmower**: parallel sweep strips back and forth across the area
- **Warp & Weft**: two perpendicular lawnmower passes for maximum overlap (cross-hatch)

Drag the polygon tool to draw a custom coverage area instead of a rectangle.

**Step 3 — Flight Parameters**
Set altitude limits (min/max AGL), safety radii, cruise speed, battery capacity, and drone weight. All defaults are sensible starting points. 

**Step 4 — Plan & Download**
Click **Plan Route**. The backend computes an optimised terrain-following path. Download the ZIP containing waypoints, a 2-D map, a 3-D terrain view, an altitude profile chart, and a mission log.

