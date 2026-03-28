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

**Step 1 — Create or open a mission**
From the dashboard, create a new mission or open an existing one. Each mission is stored as a folder under `backend/missions/`. Missions persist between sessions.

**Step 2 — Upload Terrain**
Upload one or two GeoTIFF files, or select a pre-loaded file from the terrain library. For each file, declare whether it is a DSM (surface model — includes trees and buildings) or a DTM (terrain model — bare ground). Two files give better results: the DSM is used for obstacle avoidance, the DTM for altitude planning. If you only have one file it is used for both.

**Step 3 — Place Points & Maneuvers**
Click *Start* to place your takeoff point. Optionally set a fixed takeoff altitude (MSL) or let the system derive it from the terrain. Add intermediate *Waypoints* if needed. Add *POIs* (Points of Interest) — each gets a maneuver type:
- **Lawnmower**: parallel sweep strips back and forth across the area
- **Warp & Weft**: two perpendicular lawnmower passes for maximum overlap (cross-hatch)

Draw a custom polygon to define the exact coverage area instead of a rectangle. The scan always starts from the polygon corner closest to where the drone is coming from.

**Step 4 — Flight Parameters**
Set altitude limits (min/max AGL), safety radii, cruise speed, battery capacity, and drone weight. Select from built-in drone presets or configure manually. Global settings (set from the settings panel) pre-fill defaults for every new mission.

**Step 5 — Plan & Download**
Click **Plan Route**. The backend computes an optimised terrain-following path and returns a ZIP file. Download it or generate a detailed PDF report from the Results tab.

**Step 6 — Manual Altitude Editing**
After planning, open the altitude editor to manually adjust waypoint altitudes on a profile chart, then re-run safety checks without replanning the whole route.

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

For lawnmower POIs, the sweep lines are parallel strips spaced by the *sweep spacing* value. For warp & weft, two perpendicular lawnmower passes are combined. Custom polygon areas are supported — the strips are clipped to the drawn polygon shape. The scan entry corner is chosen to be the one closest to the drone's current position, minimising transit distance.

### 3. Altitude Planning (`core/altitude.py` — 9 steps)

The altitude planner takes the assembled route and produces a smooth, terrain-following altitude profile. It works in 9 steps — see `algorithm_diagram.html` for the full walkthrough with visuals. In brief:

1. Resolve takeoff altitude from terrain + min AGL
2. Insert zone-crossing waypoints at POI boundaries; split impossible legs
3. Compute per-leg floor and ceiling from terrain samples
4. Propagate climb-rate limits in four passes to ensure every transition is reachable
5. Select cruise altitude: keep current unless forced to change
6. Clamp takeoff altitude to the first leg's floor requirement
7. Insert ramp waypoints at the start of each altitude transition
8. Add terrain pin waypoints on ramps where mid-ramp terrain would be clipped
9. Final safety check — violations are reported but never block the download

### 4. Safety Checks

Three independent checks scan every waypoint:

- **Vertical clearance** (hard): drone MSL altitude ≥ DSM surface elevation at that point
- **Horizontal bubble** (hard): nothing within `point_radius_m` may be taller than the drone
- **Camera range** (soft): drone must not be more than `max_agl_m` above the lowest surface within `max_surface_radius_m`

Hard violations mean crash risk. Soft violations are product-quality concerns (camera too far from subject). Both are shown in the UI and PDF report but never block the download.

### 5. Output Packaging

The planner packages a ZIP file containing:
- `waypoints.json` — every route point with lat, lon, MSL altitude, and metadata
- `route.kml` — importable into Google Earth and most ground control software
- `mission_report.html` — combined interactive report with 2-D map, 3-D terrain view, altitude profile, and comparison diff (if Smart Route was used)
- `mission_log.txt` — human-readable planning log with statistics and warnings

A separate PDF report (generated on demand) includes summary statistics, coverage analysis, violation tables by category, and altitude profile charts.

---

## Key Concepts Glossary

| Term | Meaning |
|------|---------|
| **AGL** | Above Ground Level — altitude measured from the terrain surface directly below the drone |
| **MSL** | Mean Sea Level — absolute altitude reference used in GPS and aviation |
| **DSM** | Digital Surface Model — elevation data including trees, buildings, and other surface objects |
| **DTM** | Digital Terrain Model — bare-ground elevation data with surface objects removed |
| **UTM** | Universal Transverse Mercator — a flat, metre-based map projection used internally |
| **Maneuver zone** | The area where the drone executes a systematic survey pattern (lawnmower or warp & weft) |
| **Point radius** | Hard horizontal bubble: anything inside this radius above the drone triggers a hard violation |
| **Camera range** | Soft check: drone must stay within `max_agl_m` of the nearest surface in a given radius |
| **Smart Route** | Lateral optimisation pass that shifts transit segments to seek flatter terrain |
| **Terrain pin** | An extra waypoint inserted on a ramp to clear a hill found mid-segment |

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
│   ├── main.py                       # FastAPI app entry point, router registration
│   ├── config.py                     # All physical constants and application defaults
│   ├── models.py                     # Pydantic v2 request/response models
│   ├── session.py                    # In-memory session store (TTL-pruned)
│   ├── api/
│   │   ├── plan.py                   # POST /plan — main planning pipeline
│   │   ├── upload.py                 # POST /upload — terrain file ingestion
│   │   ├── altitude_edit.py          # POST /altitude-edit — manual altitude adjustments
│   │   ├── editor_data.py            # GET /editor-data — profile data for altitude editor
│   │   ├── missions.py               # CRUD for /missions — mission folder management
│   │   ├── pdf.py                    # POST /pdf — on-demand PDF report generation
│   │   ├── settings.py               # GET/POST /settings — global user settings
│   │   ├── presets.py                # GET /presets — drone preset library
│   │   ├── terrain.py                # GET /terrain-library — pre-loaded TIFF files
│   │   └── dashboard.py              # GET /dashboard — mission list for dashboard
│   ├── core/
│   │   ├── altitude.py               # 9-step altitude planning algorithm
│   │   ├── altitude_edit_utils.py    # Helpers for manual altitude editing + re-check
│   │   ├── band.py                   # Per-leg AGL floor/ceiling computation
│   │   ├── battery.py                # Energy and flight time estimation
│   │   ├── geometry.py               # Polygon clipping, area, centroid utilities
│   │   ├── missions.py               # Mission folder read/write helpers
│   │   ├── poi.py                    # Lawnmower / warp-weft pattern generation
│   │   ├── route.py                  # Route assembly, resampling, waypoint ordering
│   │   ├── safety.py                 # Vertical + horizontal + camera-range checks
│   │   ├── terrain.py                # Raster reprojection and elevation sampling
│   │   ├── types.py                  # Shared dataclasses (Waypoint3D, Violation, etc.)
│   │   └── utm_utils.py              # LatLon ↔ UTM conversion helpers
│   └── export/
│       ├── mission_log.py            # Human-readable planning log
│       ├── packager.py               # ZIP assembly
│       ├── render_3d.py              # Plotly 3-D terrain + route view
│       ├── render_combined.py        # Combined interactive HTML report
│       ├── render_kml.py             # KML export
│       ├── render_map.py             # Folium 2-D interactive map
│       ├── render_pdf.py             # PDF report (fpdf2)
│       ├── render_pdf_charts.py      # Matplotlib charts embedded in PDF
│       ├── render_profile.py         # Plotly altitude profile chart
│       ├── render_smart_route_diff.py# Before/after Smart Route comparison overlay
│       └── waypoints.py              # Waypoint JSON/KML serialisation
└── frontend/
    └── src/
        ├── App.tsx                   # Main app shell, top-level state
        ├── LandingPage.tsx           # Dashboard / mission selector
        ├── main.tsx                  # React entry point, React Router setup
        ├── theme.ts                  # MUI theme customisation
        ├── constants.ts              # Shared frontend constants
        ├── dronePresets.ts           # Built-in drone preset definitions
        ├── api/index.ts              # Backend API client functions
        ├── types/mission.ts          # TypeScript types for mission data
        ├── hooks/
        │   ├── useMissionState.ts    # Core mission point state
        │   ├── usePlanRoute.ts       # Plan request and result handling
        │   ├── useLiveEstimates.ts   # Live pre-plan estimates (battery, time)
        │   ├── useFlightPreview.ts   # Animated in-flight preview
        │   ├── useDraftPersistence.ts# Auto-save draft to localStorage
        │   ├── useRouteIO.ts         # Route import/export
        │   ├── useAltitudeEditor.ts  # Manual altitude editor state
        │   ├── useUndoRedo.ts        # Undo/redo history stack
        │   └── useTutorial.ts        # Tutorial overlay state
        ├── components/
        │   ├── FlightConfigPanel.tsx # Flight parameter accordion form
        │   ├── ManeuverCard.tsx      # Per-POI maneuver configuration
        │   ├── ResultsPanel.tsx      # Post-plan results, violations, download
        │   ├── UploadPanel.tsx       # Terrain file upload
        │   ├── AltitudeEditorModal.tsx # Manual altitude editor modal
        │   ├── GlobalSettingsPanel.tsx # Global defaults settings panel
        │   ├── altitude-editor/
        │   │   └── AltitudeChart.tsx # Profile chart for manual editor
        │   ├── map/
        │   │   ├── MapCanvas.tsx     # Leaflet map container + layer manager
        │   │   ├── MapToolbar.tsx    # Drawing tool buttons
        │   │   ├── MapMarkers.tsx    # Start/waypoint/POI markers
        │   │   ├── MapRoute.tsx      # Planned route polyline overlay
        │   │   ├── MapViolationLayer.tsx # Colour-coded violation markers
        │   │   ├── ManeuverPreview.tsx   # Scan rectangle/strip preview
        │   │   ├── PolygonDrawHandler.tsx# Custom polygon drawing
        │   │   ├── PolygonOverlay.tsx    # Saved polygon display
        │   │   └── icons.ts          # Leaflet DivIcon builders (violations, POIs)
        │   ├── sidebar/
        │   │   ├── SidebarShell.tsx  # Tab container (Mission / Config / Results)
        │   │   ├── MissionTab.tsx    # Mission point list + POI list
        │   │   ├── ConfigTab.tsx     # Flight config tab wrapper
        │   │   ├── ResultsTab.tsx    # Results tab wrapper
        │   │   ├── StartPointSection.tsx # Start point controls
        │   │   ├── PoiSection.tsx    # POI list controls
        │   │   ├── LiveEstimatesBar.tsx  # Pre-plan live estimates bar
        │   │   ├── FlightPreviewPanel.tsx# Animated flight preview panel
        │   │   └── PdfReportDialog.tsx   # PDF generation dialog
        │   └── tutorial/
        │       └── TutorialOverlay.tsx   # Interactive onboarding tutorial
        └── pages/
            ├── DashboardPage.tsx     # Mission list / new mission page
            └── MissionsPage.tsx      # Mission planner page
```

---

## API Reference

### Terrain

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/upload` | Upload GeoTIFF file(s); returns session with file metadata |
| `GET` | `/terrain-library` | List pre-loaded TIFF files available for selection |

### Planning

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/plan` | Run the full planning pipeline; returns ZIP + `X-Plan-Meta` header |
| `GET` | `/editor-data/{session_id}` | Fetch waypoint + terrain profile for the altitude editor |
| `POST` | `/altitude-edit` | Re-run safety checks after manual altitude adjustments |
| `POST` | `/pdf` | Generate a PDF report for a completed plan |

### Missions

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/missions` | List all saved mission folders |
| `GET` | `/missions/{folder}` | Load a saved mission (route + config) |
| `POST` | `/missions/{folder}` | Save mission state to disk |
| `DELETE` | `/missions/{folder}` | Delete a mission folder |
| `GET` | `/dashboard` | Summary list for the dashboard (name, date, stats) |

### Configuration

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/settings` | Load global user settings |
| `POST` | `/settings` | Save global user settings |
| `GET` | `/presets` | List built-in drone presets |

### Plan Request Body

`POST /plan` accepts a JSON `RouteRequest` body (see `backend/models.py`). Key fields:

```json
{
  "session_id": "...",
  "start": { "lat": 0.0, "lon": 0.0 },
  "waypoints": [],
  "pois": [
    {
      "point": { "lat": 0.0, "lon": 0.0 },
      "maneuver": {
        "type": "lawnmower",
        "width_m": 100,
        "height_m": 100,
        "sweep_spacing_m": 10,
        "polygon": []
      }
    }
  ],
  "flight_config": {
    "min_agl_m": 15,
    "max_agl_m": 80,
    "point_radius_m": 5,
    "cruise_speed_ms": 8,
    "battery_wh": 200,
    "drone_weight_kg": 1.5
  }
}
```

### Plan Response

- **Body**: `application/zip`
- **`X-Plan-Meta` header**: JSON with flight statistics and violation list

```json
{
  "total_distance_m": 1234.5,
  "flight_time_s": 154,
  "battery_pct": 42.1,
  "violations": [
    {
      "category": "safety",
      "kind": "vertical",
      "lat": 0.0,
      "lon": 0.0,
      "message": "...",
      "measured_value": 0.0,
      "limit_value": 0.0
    }
  ]
}
```

Violation `category` values: `"safety"` (hard — crash risk), `"product_poi"` (soft — scan quality), `"product_route"` (soft — transit quality).
