import React from "react";
import { Marker, Polygon, useMapEvents } from "react-leaflet";
import type { LatLon, Poi } from "../../types/mission";
import { haversineM, formatDist } from "../../utils/math";
import { makeDistanceIcon, inProgressVertexIcon, savedVertexIcon } from "./icons";

interface PolygonDrawLayerProps {
  vertices: LatLon[];
  onVertexDragInProgress: (vi: number, pt: LatLon) => void;
}

/** In-progress polygon while the user is actively drawing. */
export function PolygonDrawLayer({ vertices, onVertexDragInProgress }: PolygonDrawLayerProps) {
  if (vertices.length === 0) return null;

  return (
    <>
      {vertices.length >= 2 && (
        <Polygon
          positions={vertices.map((v) => [v.lat, v.lon])}
          pathOptions={{ color: "#FF9800", fillColor: "#FF9800", fillOpacity: 0.1, weight: 2, dashArray: "6 4" }}
        />
      )}
      {vertices.map((v, i) => (
        <Marker
          key={`pdv-${i}`}
          position={[v.lat, v.lon]}
          icon={inProgressVertexIcon}
          draggable
          eventHandlers={{
            drag(e) {
              const { lat, lng } = e.target.getLatLng();
              onVertexDragInProgress(i, { lat, lon: lng });
            },
          }}
        />
      ))}
      {/* Edge length labels */}
      {vertices.length >= 2 && vertices.map((v, i) => {
        if (i === vertices.length - 1) return null;
        const next = vertices[i + 1];
        const a: [number, number] = [v.lat, v.lon];
        const b: [number, number] = [next.lat, next.lon];
        const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        return (
          <Marker key={`pdel-${i}`} position={mid} icon={makeDistanceIcon(formatDist(haversineM(a, b)))} interactive={false} />
        );
      })}
    </>
  );
}

interface SavedPolygonLayersProps {
  pois: Poi[];
  onVertexDrag: (poiIdx: number, vi: number, pt: LatLon) => void;
}

/** Saved polygon overlays for all POIs — with draggable vertex handles and edge labels. */
export function SavedPolygonLayers({ pois, onVertexDrag }: SavedPolygonLayersProps) {
  return (
    <>
      {pois.map((poi, poiIdx) => {
        const poly = poi.maneuver.polygon;
        if (!poly || poly.length < 3) return null;
        return (
          <React.Fragment key={`polygroup-${poiIdx}`}>
            <Polygon
              positions={poly.map((v) => [v.lat, v.lon])}
              pathOptions={{ color: "#f44336", fillColor: "#f44336", fillOpacity: 0.08, weight: 1.5 }}
            />
            {poly.map((v, vi) => (
              <Marker
                key={`pv-${poiIdx}-${vi}`}
                position={[v.lat, v.lon]}
                icon={savedVertexIcon}
                draggable
                eventHandlers={{
                  drag(e) {
                    const { lat, lng } = e.target.getLatLng();
                    onVertexDrag(poiIdx, vi, { lat, lon: lng });
                  },
                }}
              />
            ))}
            {poly.map((v, vi) => {
              const next = poly[(vi + 1) % poly.length];
              const a: [number, number] = [v.lat, v.lon];
              const b: [number, number] = [next.lat, next.lon];
              const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
              return (
                <Marker key={`pel-${poiIdx}-${vi}`} position={mid} icon={makeDistanceIcon(formatDist(haversineM(a, b)))} interactive={false} />
              );
            })}
          </React.Fragment>
        );
      })}
    </>
  );
}

/** Cursor coordinate tracker — must be mounted inside MapContainer. */
export function CursorTracker({ onMove }: { onMove: (pt: [number, number] | null) => void }): null {
  useMapEvents({
    mousemove(e) { onMove([e.latlng.lat, e.latlng.lng]); },
    mouseout()   { onMove(null); },
  });
  return null;
}
