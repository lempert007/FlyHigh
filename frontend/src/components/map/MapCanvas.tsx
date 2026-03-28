import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Box, Button, Slide, Snackbar, Typography } from "@mui/material";
import { ImageOverlay, MapContainer, Rectangle, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import type {
  ElevationOverlay,
  InteractionMode,
  LatLon,
  PlaceMode,
  Poi,
  UploadResult,
  Violation,
  Waypoint,
} from "../../types/mission";
import type { InteractionState } from "../../types/mission";
import { haversineM, formatDist } from "../../utils/math";
import type { FlightPreviewState } from "../../hooks/useFlightPreview";
import { AutoFit } from "./AutoFit";
import { RubberBand } from "./RubberBand";
import { RulerOverlay, RulerCursorTracker } from "./RulerOverlay";
import { PolygonDrawLayer, SavedPolygonLayers, CursorTracker } from "./PolygonOverlay";
import { ClickHandler } from "./ClickHandler";
import { PolygonDrawHandler } from "./PolygonDrawHandler";
import { RadiusLayer, RadiusInputPopup } from "./RadiusTool";
import type { RadiusCircle } from "./RadiusTool";
import { MapToolbar } from "./MapToolbar";

/**
 * Isolated component so that cursor-move re-renders of MapCanvas
 * never touch the ImageOverlay tree. The custom comparator does a
 * proper Set-contents comparison rather than reference equality.
 */
const ElevationLayers = memo(
  function ElevationLayers({
    overlays,
    visible,
    opacity,
  }: {
    overlays: ElevationOverlay[];
    visible: Set<string>;
    opacity: number;
  }) {
    return (
      <>
        {overlays
          .filter((ov) => visible.has(ov.filename))
          .map((ov) => (
            <ImageOverlay
              key={ov.filename}
              url={ov.url}
              bounds={[
                [ov.bbox[1], ov.bbox[0]],
                [ov.bbox[3], ov.bbox[2]],
              ]}
              opacity={opacity}
              zIndex={10}
            />
          ))}
      </>
    );
  },
  (prev, next) => {
    if (prev.opacity !== next.opacity) return false;
    if (prev.overlays !== next.overlays) return false;
    if (prev.visible.size !== next.visible.size) return false;
    for (const name of prev.visible) {
      if (!next.visible.has(name)) return false;
    }
    return true;
  }
);
import { MapMarkers } from "./MapMarkers";
import { MapRoute, FitOnUpload } from "./MapRoute";
import { MapViolationLayer } from "./MapViolationLayer";

export interface MapCanvasProps {
  start: LatLon | null;
  waypoints: Waypoint[];
  pois: Poi[];
  uploadResult: UploadResult | null;
  routePoints: LatLon[];
  routeAglProfile?: number[];
  minAglM?: number;
  mapFlyTarget?: LatLon | null;
  interaction: InteractionState;
  onPlacePoint: (pt: LatLon) => void;
  onSetPlaceMode: (mode: InteractionMode) => void;
  onPolygonVertex: (pt: LatLon) => void;
  onPolygonClose: () => void;
  onPolygonVertexDrag: (poiIdx: number, vi: number, pt: LatLon) => void;
  onPolygonVertexDragInProgress: (vi: number, pt: LatLon) => void;
  onPoiDrag: (poiIdx: number, pt: LatLon) => void;
  elevationOverlays: ElevationOverlay[];
  sessionId: string | null;
  mapBottomPad?: string;
  flightPreview?: FlightPreviewState;
  violations?: Violation[];
}

function FlyTarget({ target }: { target: LatLon | null | undefined }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.flyTo([target.lat, target.lon], 17, { animate: true, duration: 0.8 });
  }, [target, map]);
  return null;
}

function ZoomControls() {
  const map = useMap();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      L.DomEvent.disableClickPropagation(containerRef.current);
      L.DomEvent.disableScrollPropagation(containerRef.current);
    }
  }, []);

  const btn = {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 28,
    height: 28,
    cursor: "pointer",
    color: "#c9d1d9",
    fontSize: "1.1rem",
    fontWeight: 300,
    lineHeight: 1,
    userSelect: "none" as const,
    "&:hover": { bgcolor: "rgba(255,255,255,0.07)", color: "#fff" },
    transition: "all 0.15s",
  };

  return (
    <Box
      ref={containerRef}
      sx={{
        position: "absolute",
        top: 10,
        right: 10,
        zIndex: 1000,
        bgcolor: "#161b22",
        border: "1px solid #30363d",
        borderRadius: "6px",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Box
        sx={{ ...btn, borderBottom: "1px solid #30363d" }}
        onClick={() => map.setZoom(map.getZoom() + 1)}
      >
        +
      </Box>
      <Box sx={btn} onClick={() => map.setZoom(map.getZoom() - 1)}>
        −
      </Box>
    </Box>
  );
}

function resolveAnchor(
  placeMode: string,
  start: LatLon | null,
  waypoints: Waypoint[],
  pois: Poi[]
): [number, number] | null {
  if (placeMode === "none" || placeMode === "start") return null;
  if (placeMode === "waypoint") {
    if (waypoints.length > 0)
      return [waypoints[waypoints.length - 1].lat, waypoints[waypoints.length - 1].lon];
    if (start) return [start.lat, start.lon];
    return null;
  }
  if (placeMode === "poi") {
    if (pois.length > 0) return [pois[pois.length - 1].point.lat, pois[pois.length - 1].point.lon];
    if (waypoints.length > 0)
      return [waypoints[waypoints.length - 1].lat, waypoints[waypoints.length - 1].lon];
    if (start) return [start.lat, start.lon];
    return null;
  }
  return null;
}

function buildRouteSequence(
  start: LatLon | null,
  waypoints: Waypoint[],
  pois: Poi[]
): [number, number][] {
  const pts: [number, number][] = [];
  if (start) pts.push([start.lat, start.lon]);
  for (const wp of waypoints) pts.push([wp.lat, wp.lon]);
  for (const p of pois) pts.push([p.point.lat, p.point.lon]);
  return pts;
}

export default function MapCanvas({
  start,
  waypoints,
  pois,
  uploadResult,
  routePoints,
  interaction,
  onPlacePoint,
  onSetPlaceMode,
  onPolygonVertex,
  onPolygonClose,
  onPolygonVertexDrag,
  onPolygonVertexDragInProgress,
  onPoiDrag,
  elevationOverlays,
  sessionId,
  mapBottomPad = "8px",
  flightPreview,
  routeAglProfile,
  minAglM,
  mapFlyTarget,
  violations,
}: MapCanvasProps) {
  const placeMode: PlaceMode =
    interaction.mode === "polygon" ? "none" : (interaction.mode as PlaceMode);
  const polygonDrawPoiIndex = interaction.mode === "polygon" ? interaction.poiIndex : null;
  const polygonVertices = interaction.polygonVertices;

  const [rulerMode, setRulerMode] = useState(false);
  const [rulerPoints, setRulerPoints] = useState<[number, number][]>([]);
  const [rulerCursor, setRulerCursor] = useState<[number, number] | null>(null);
  const [elevationOpacity, setElevationOpacity] = useState(0.6);
  const [visibleOverlays, setVisibleOverlays] = useState<Set<string>>(new Set());

  // When overlays change (new upload), reset all to visible
  useEffect(() => {
    setVisibleOverlays(new Set(elevationOverlays.map((o) => o.filename)));
  }, [elevationOverlays]);
  const [polyToast, setPolyToast] = useState(false);
  const [cursorLatLon, setCursorLatLon] = useState<[number, number] | null>(null);
  const [cursorElevation, setCursorElevation] = useState<number | null>(null);
  const [fitKey, setFitKey] = useState(0);

  const [radiusMode, setRadiusMode] = useState(false);
  const [radiusCircles, setRadiusCircles] = useState<RadiusCircle[]>([]);
  const [pendingCenter, setPendingCenter] = useState<LatLon | null>(null);
  const [pendingRadiusM, setPendingRadiusM] = useState("");

  const elevFetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!cursorLatLon || !sessionId || !elevationOverlays.length) {
      setCursorElevation(null);
      return;
    }
    const [lat, lon] = cursorLatLon;
    const inside = elevationOverlays.some(
      ({ bbox: [w, s, e, n] }) => lon >= w && lon <= e && lat >= s && lat <= n
    );
    if (!inside) {
      setCursorElevation(null);
      return;
    }

    if (elevFetchTimer.current) clearTimeout(elevFetchTimer.current);
    elevFetchTimer.current = setTimeout(async () => {
      try {
        const r = await fetch(`/elevation-point/${sessionId}?lat=${lat}&lon=${lon}`);
        if (r.ok) {
          const { elevation_m } = (await r.json()) as { elevation_m: number };
          setCursorElevation(elevation_m);
        }
      } catch {
        /* network error — silently ignore */
      }
    }, 120);
    return () => {
      if (elevFetchTimer.current) clearTimeout(elevFetchTimer.current);
    };
  }, [cursorLatLon, sessionId, elevationOverlays]);

  // Esc: cancel ruler, cancel pending radius, or exit radius mode
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (rulerMode) {
        setRulerMode(false);
        setRulerPoints([]);
        setRulerCursor(null);
      }
      if (pendingCenter) {
        setPendingCenter(null);
        setPendingRadiusM("");
      } else if (radiusMode) {
        setRadiusMode(false);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [rulerMode, radiusMode, pendingCenter]);

  const allLatLons = useMemo(
    () => [
      ...(start ? ([[start.lat, start.lon]] as [number, number][]) : []),
      ...waypoints.map((w): [number, number] => [w.lat, w.lon]),
      ...pois.map((p): [number, number] => [p.point.lat, p.point.lon]),
      ...routePoints.map((p): [number, number] => [p.lat, p.lon]),
    ],
    [start, waypoints, pois, routePoints]
  );

  const routeSequence = buildRouteSequence(start, waypoints, pois);
  const routeLeaflet = routePoints.map((p): [number, number] => [p.lat, p.lon]);
  const rubberAnchor = resolveAnchor(placeMode, start, waypoints, pois);

  function toggleRuler() {
    if (rulerMode) {
      setRulerMode(false);
      setRulerPoints([]);
      setRulerCursor(null);
    } else {
      setRulerMode(true);
      setRadiusMode(false);
      setPendingCenter(null);
      onSetPlaceMode("none");
    }
  }

  function toggleRadiusMode() {
    if (radiusMode) {
      setRadiusMode(false);
      setPendingCenter(null);
      setPendingRadiusM("");
    } else {
      setRadiusMode(true);
      setRulerMode(false);
      setRulerPoints([]);
      onSetPlaceMode("none");
    }
  }

  function confirmRadius() {
    const r = parseFloat(pendingRadiusM);
    if (!pendingCenter || isNaN(r) || r <= 0) return;
    setRadiusCircles((prev) => [...prev, { id: Date.now(), ...pendingCenter, radiusM: r }]);
    setPendingCenter(null);
    setPendingRadiusM("");
  }

  const isActive = placeMode !== "none" || polygonDrawPoiIndex !== null || rulerMode;
  const cursor = isActive || radiusMode ? "crosshair" : "grab";

  const statusText =
    polygonDrawPoiIndex !== null
      ? `Drawing polygon — ${polygonVertices.length} vertices (need ≥ 3)`
      : rulerMode
        ? `Measuring${rulerPoints.length > 1 ? ` — ${formatDist(rulerPoints.reduce((sum, _, i) => (i === 0 ? sum : sum + haversineM(rulerPoints[i - 1], rulerPoints[i])), 0))}` : " — click to start"}`
        : `Placing: ${placeMode} — click to confirm (Esc to cancel)`;

  return (
    <Box sx={{ height: "100%", width: "100%", position: "relative", cursor }}>
      <MapContainer
        center={[39, -98]}
        zoom={4}
        zoomControl={false}
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <ElevationLayers
          overlays={elevationOverlays}
          visible={visibleOverlays}
          opacity={elevationOpacity}
        />

        {uploadResult?.files?.map((f) => (
          <Rectangle
            key={`bbox-${f.name}`}
            bounds={[
              [f.bbox[1], f.bbox[0]],
              [f.bbox[3], f.bbox[2]],
            ]}
            pathOptions={{
              color: f.inferred_type === "DTM" ? "#4caf50" : "#FF9800",
              weight: 1.5,
              dashArray: "6 4",
              fillOpacity: 0,
            }}
          />
        ))}

        {polygonDrawPoiIndex !== null ? (
          <PolygonDrawHandler
            onVertex={onPolygonVertex}
            onClose={onPolygonClose}
            vertexCount={polygonVertices.length}
            onNotEnoughVertices={() => setPolyToast(true)}
          />
        ) : (
          <ClickHandler
            placeMode={placeMode}
            onPlacePoint={onPlacePoint}
            rulerMode={rulerMode}
            onRulerClick={(pt) => setRulerPoints((p) => [...p, pt])}
            radiusMode={radiusMode}
            onRadiusClick={(pt) => {
              setPendingCenter(pt);
              setPendingRadiusM("");
            }}
          />
        )}

        <AutoFit allLatLons={allLatLons} fitKey={fitKey} />
        <FitOnUpload uploadResult={uploadResult} />
        <CursorTracker onMove={setCursorLatLon} />
        {rulerMode && <RulerCursorTracker onMove={setRulerCursor} />}
        <RulerOverlay points={rulerPoints} cursor={rulerMode ? rulerCursor : null} />

        <RadiusLayer circles={radiusCircles} pendingCenter={pendingCenter} />

        {!rulerMode && placeMode !== "none" && polygonDrawPoiIndex === null && (
          <RubberBand anchor={rubberAnchor} />
        )}

        <PolygonDrawLayer
          vertices={polygonVertices}
          onVertexDragInProgress={onPolygonVertexDragInProgress}
        />
        <SavedPolygonLayers pois={pois} onVertexDrag={onPolygonVertexDrag} />

        <FlyTarget target={mapFlyTarget} />
        <ZoomControls />

        <MapRoute
          routeLeaflet={routeLeaflet}
          allLatLons={allLatLons}
          routeAglProfile={routeAglProfile}
          minAglM={minAglM}
          flightPreview={flightPreview}
        />

        <MapMarkers
          start={start}
          waypoints={waypoints}
          pois={pois}
          routeSequence={routeSequence}
          hasRoute={routeLeaflet.length > 1}
          onPoiDrag={onPoiDrag}
        />

        <MapViolationLayer violations={violations ?? []} />
      </MapContainer>

      {/* Cursor coordinates + elevation — bottom right */}
      {cursorLatLon && (
        <Box
          sx={{
            position: "absolute",
            bottom: mapBottomPad,
            right: 8,
            zIndex: 1000,
            transition: "bottom 0.3s",
            bgcolor: "rgba(13,17,23,0.85)",
            border: "1px solid #30363d",
            borderRadius: 1,
            px: 1.5,
            py: 0.5,
            fontFamily: "monospace",
            fontSize: "0.7rem",
            color: "text.secondary",
            pointerEvents: "none",
          }}
        >
          {cursorLatLon[0].toFixed(5)}, {cursorLatLon[1].toFixed(5)}
          {cursorElevation != null && (
            <span style={{ color: "#4fc3f7", marginLeft: 8 }}>{cursorElevation.toFixed(1)} m</span>
          )}
        </Box>
      )}

      <RadiusInputPopup
        pendingCenter={pendingCenter}
        pendingRadiusM={pendingRadiusM}
        onChangeRadius={setPendingRadiusM}
        onConfirm={confirmRadius}
        onCancel={() => {
          setPendingCenter(null);
          setPendingRadiusM("");
        }}
      />

      <MapToolbar
        placeMode={placeMode}
        rulerMode={rulerMode}
        radiusMode={radiusMode}
        elevationOverlays={elevationOverlays}
        visibleOverlays={visibleOverlays}
        elevationOpacity={elevationOpacity}
        mapBottomPad={mapBottomPad}
        onSetPlaceMode={(mode) => {
          setRulerMode(false);
          setRulerPoints([]);
          onSetPlaceMode(mode);
        }}
        onToggleRuler={toggleRuler}
        onToggleRadius={toggleRadiusMode}
        onFit={() => setFitKey((k) => k + 1)}
        onElevationOpacity={setElevationOpacity}
        onToggleOverlay={(name) =>
          setVisibleOverlays((prev) => {
            const next = new Set(prev);
            if (next.has(name)) next.delete(name);
            else next.add(name);
            return next;
          })
        }
      />

      {/* Active mode status badge — top center */}
      {isActive && (
        <Box
          sx={{
            position: "absolute",
            top: 10,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 1000,
            bgcolor: "rgba(22,27,34,0.92)",
            border: "1px solid #30363d",
            borderRadius: 2,
            px: 2,
            py: 0.75,
            pointerEvents: "none",
          }}
        >
          <Typography
            variant="caption"
            sx={{ color: "#ff9100", fontWeight: 600, fontFamily: "monospace" }}
          >
            {statusText}
          </Typography>
        </Box>
      )}

      {/* Finish Polygon button — bottom center */}
      {polygonDrawPoiIndex !== null && polygonVertices.length >= 3 && (
        <Box
          sx={{
            position: "absolute",
            bottom: 60,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 1000,
          }}
        >
          <Button
            variant="contained"
            size="small"
            color="success"
            onClick={onPolygonClose}
            sx={{ textTransform: "none", fontWeight: 600, borderRadius: 2 }}
          >
            ✓ Finish Polygon ({polygonVertices.length} vertices)
          </Button>
        </Box>
      )}

      <Snackbar
        open={polyToast}
        onClose={() => setPolyToast(false)}
        autoHideDuration={3000}
        TransitionComponent={Slide}
        message="Need at least 3 vertices to close a polygon"
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      />
    </Box>
  );
}
