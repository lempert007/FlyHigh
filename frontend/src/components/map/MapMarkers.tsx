/**
 * All point markers rendered inside the MapContainer:
 * start, land, waypoints, POIs (draggable), and segment distance labels.
 */

import React from "react";
import { Marker } from "react-leaflet";
import type { LatLon, Poi, Waypoint } from "../../types/mission";
import { haversineM, formatDist } from "../../utils/math";
import { makeDistanceIcon, poiIcon, startIcon, landIcon, waypointIcon } from "./icons";
import { ManeuverPreview } from "./ManeuverPreview";

interface MapMarkersProps {
  start: LatLon | null;
  waypoints: Waypoint[];
  pois: Poi[];
  routeSequence: [number, number][];
  hasRoute: boolean;
  onPoiDrag: (poiIdx: number, pt: LatLon) => void;
}

export function MapMarkers({ start, waypoints, pois, routeSequence, hasRoute, onPoiDrag }: MapMarkersProps) {
  return (
    <>
      {start && <Marker position={[start.lat, start.lon]} icon={startIcon} />}
      {start && hasRoute && (
        <Marker position={[start.lat + 0.00005, start.lon + 0.00005]} icon={landIcon} />
      )}

      {waypoints.map((wp, i) => (
        <Marker key={i} position={[wp.lat, wp.lon]} icon={waypointIcon(i + 1)} />
      ))}

      {pois.map((poi, i) => (
        <React.Fragment key={i}>
          <Marker
            position={[poi.point.lat, poi.point.lon]}
            icon={poiIcon(i + 1)}
            draggable
            eventHandlers={{
              dragend(e) {
                const { lat, lng } = e.target.getLatLng();
                onPoiDrag(i, { lat, lon: lng });
              },
            }}
          />
          <ManeuverPreview poi={poi} />
        </React.Fragment>
      ))}

      {routeSequence.length > 1 && routeSequence.slice(0, -1).map((a, i) => {
        const b = routeSequence[i + 1];
        const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        return (
          <Marker key={`dist-${i}`} position={mid} icon={makeDistanceIcon(formatDist(haversineM(a, b)))} interactive={false} />
        );
      })}
    </>
  );
}
