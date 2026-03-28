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
Set altitude limits (min/max AGL), safety radii, cruise speed, battery capacity, and drone weight. All defaults are sensible starting points. Key parameters:
- **Min clearance radius**: hard violation if anything within this radius exceeds drone altitude
- **Awareness radius**: soft warning for tall structures in this wider zone

**Step 4 — Plan & Download**
Click **Plan Route**. The backend computes an optimised terrain-following path. Download the ZIP containing waypoints, a 2-D map, a 3-D terrain view, an altitude profile chart, and a mission log.

---

## The Algorithm — Plain Language

Here is what happens inside FlyHigh when you click "Plan Route":

### 1. Terrain Loading

The uploaded GeoTIFF files are reprojected from their native coordinate system (often geographic lat/lon) into UTM — a flat, metre-based grid. This lets the planner work in real-world distances without dealing with the curvature of the Earth at typical mission scales.

### 2. Route Assembly

The planner builds an ordered list of waypoints:
- **Start** point
- **Intermediate waypoints** (optional transit stops)
- For each **POI**: a sequence of sweep lines generated to cover the area at the requested spacing
- **Landing** (always back at the start — return-to-home)

For lawnmower POIs, the sweep lines are parallel strips spaced by the *sweep spacing* value. For warp & weft, two perpendicular lawnmower passes are combined. Custom polygon areas are supported — the strips are clipped to the drawn polygon shape.

### 3. Path Resampling

The sparse keypoint list is densified into a fine grid of equally-spaced points (default 5 m apart). This gives the altitude planner a value to compute at every metre of the route.

### 4. Terrain Sampling

For every dense route point, the planner looks up the ground elevation from the DTM interpolator. Points outside the terrain data boundary are conservatively filled with the highest known elevation plus the maximum AGL — the drone stays well above unknown ground rather than dropping to sea level.

### 5. Initial Altitude Profile

Instead of terrain-following (which produces a very bumpy flight), the planner builds a flat initial profile: for each segment between keypoints, it finds the *highest* terrain point in that segment and adds the minimum AGL clearance. The result clears every obstacle in each segment without unnecessary climbing. A Gaussian (bell-curve) smoothing pass then blends sharp steps into gentle ramps.

### 6. Per-POI Altitude Pinning

Each POI maneuver zone gets pinned to a fixed constant altitude: the average terrain height inside the zone plus the midpoint of the POI's AGL band. This keeps the drone at a stable height during sweeps — essential for consistent photo overlap and camera focus distance.

### 7. Altitude Optimisation

An L-BFGS-B optimiser (a standard numerical method for bounded problems) refines the altitude profile to minimise energy consumption while staying within the [min AGL, max AGL] band everywhere. Maneuver zones are locked — the optimiser cannot touch them. The optimiser runs on a coarser 20 m grid for speed, then interpolates back to the full resolution.

### 8. Slope Limiting — Approach and Departure Ramps

The optimised profile may still have transitions that are too steep for a real drone. A two-pass causal filter enforces a maximum climb angle (default 8° — about 1 m climb per 7 m forward):

- **Backward pass** (approach): looks at each pinned maneuver zone and forces transit points *before* the zone to start descending (or climbing) early enough to arrive at exactly the right altitude. This creates smooth approach ramps.
- **Forward pass** (departure): same thing leaving a maneuver zone — the climb away is spread over the required distance, starting right at the zone exit.

Together the two passes produce straight, linear ramps at a constant angle — no kinks, no S-curves, and the ramp always starts as early as physics requires.

### 9. Safety Checks

Two safety checks scan the entire final route:

- **Vertical clearance**: the drone's MSL altitude must be at or above every DSM surface point along the route.
- **Horizontal bubbles**: for every route point, the DSM is sampled on a ring at the *min clearance radius*. If anything on the ring is taller than the drone, it is flagged as a hard violation. A second, wider ring at the *awareness radius* generates soft warnings for nearby tall structures that are not in the immediate flight path.

Violations never block the download — the route is always returned so you can inspect and adjust parameters.

### 10. Output Packaging

The planner packages a ZIP file containing:
- `waypoints.json` — every route point with lat, lon, MSL altitude, heading, speed, and action type
- `route.kml` — importable into Google Earth and most ground control software
- `mission_report.html` — a combined interactive report with a 2-D map, 3-D terrain view, and altitude profile chart
- `mission_log.txt` — human-readable planning log with statistics and any warnings

---

## Key Concepts Glossary

| Term | Meaning |
|------|---------|
| **AGL** | Above Ground Level — altitude measured from the terrain surface directly below the drone |
| **MSL** | Mean Sea Level — absolute altitude reference used in GPS and aviation |
| **DSM** | Digital Surface Model — elevation data that includes trees, buildings, and other surface objects |
| **DTM** | Digital Terrain Model — bare-ground elevation data with surface objects removed |
| **UTM** | Universal Transverse Mercator — a flat, metre-based map projection used internally for distance calculations |
| **Maneuver zone** | The area where the drone executes a systematic survey pattern (lawnmower or warp & weft) |
| **Min clearance radius** | Hard horizontal bubble: anything inside this radius above the drone triggers a violation |
| **Awareness radius** | Wider soft-warning zone: tall structures here generate warnings rather than hard violations |
| **L-BFGS-B** | A gradient-based numerical optimisation method well-suited to problems with bounded variables |
| **Slope limit** | Maximum climb or descent angle (8°) enforced as a two-pass filter on the altitude profile |

---

## Test GeoTIFF Files

Free terrain data sources:
- **OpenTopography** — https://opentopography.org (select a region, export as GeoTIFF)
- **USGS 3DEP** — https://apps.nationalmap.gov/downloader (1 m or 1/3 arc-second DEM)
- **Copernicus DEM** — https://portal.opentopography.org/raster?opentopoID=OTSDEM.032021.4326.3

---

## File Structure

```
FlyHigh/
├── backend/
│   ├── main.py              # FastAPI app entry point
│   ├── config.py            # All physical constants and defaults
│   ├── models.py            # Pydantic v2 request/response models
│   ├── session.py           # In-memory session store (TTL-pruned)
│   ├── api/
│   │   ├── plan.py          # POST /plan — main planning pipeline
│   │   └── upload.py        # POST /upload — terrain file ingestion
│   ├── core/
│   │   ├── route.py         # Path resampling, altitude smoothing, slope limiting
│   │   ├── terrain.py       # Raster reprojection and elevation sampling
│   │   ├── safety.py        # Vertical + horizontal safety checks
│   │   ├── maneuvers.py     # Lawnmower and warp & weft pattern generation
│   │   ├── battery.py       # Energy and flight time estimation
│   │   └── cost.py          # Optimiser objective function
│   └── export/
│       ├── render_map.py    # Folium 2-D interactive map
│       ├── render_profile.py# Plotly altitude profile chart
│       ├── render_3d.py     # Plotly 3-D terrain + route view
│       ├── render_kml.py    # KML export
│       ├── mission_log.py   # Human-readable planning log
│       └── packager.py      # ZIP assembly
└── frontend/
    └── src/
        ├── App.jsx                      # Main application shell and state
        ├── api.js                       # Backend API client functions
        └── components/
            ├── UploadPanel.jsx          # Terrain file upload with type declaration
            ├── MapCanvas.jsx            # Interactive Leaflet map with drawing tools
            ├── FlightConfigPanel.jsx    # Flight parameter accordion form
            ├── ManeuverCard.jsx         # Per-POI maneuver configuration
            └── ResultsPanel.jsx         # Post-plan results, violations, download
```

---

## API Reference

### `POST /upload`
- **Body**: `multipart/form-data` with one or more `.tif` files and a `file_types` JSON field (`{"filename.tif": "DSM"}`)
- **Returns**: `{ session_id, files: [{ name, resolution_m, bbox, crs, inferred_type }] }`

### `POST /plan`
- **Body**: JSON `RouteRequest` (see `models.py`)
- **Returns**: `application/zip`; `X-Plan-Meta` response header contains JSON with flight statistics and violation list
