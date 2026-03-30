import React from "react";
import { Marker, Polyline, useMapEvents } from "react-leaflet";
import L from "leaflet";
import { haversineM, bearingDeg, formatDist } from "../../utils/math";
import { makeDistanceIcon } from "./icons";

interface RulerOverlayProps {
  points: [number, number][];
  cursor: [number, number] | null;
}

function rulerLabel(a: [number, number], b: [number, number], dist: number): string {
  const az = bearingDeg(a, b);
  return `${formatDist(dist)}  ${az.toFixed(1)}°`;
}

/** Ruler: persistent polyline + distance badges between measured points. */
export function RulerOverlay({ points, cursor }: RulerOverlayProps): React.ReactElement | null {
  if (points.length === 0) return null;

  const segments = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i],
      b = points[i + 1];
    const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    segments.push({ a, b, mid, dist: haversineM(a, b) });
  }

  let liveSeg: {
    a: [number, number];
    b: [number, number];
    mid: [number, number];
    dist: number;
  } | null = null;
  if (cursor) {
    const a = points[points.length - 1];
    liveSeg = {
      a,
      b: cursor,
      mid: [(a[0] + cursor[0]) / 2, (a[1] + cursor[1]) / 2],
      dist: haversineM(a, cursor),
    };
  }

  const dotIcon = L.divIcon({
    className: "",
    html: `<div style="width:8px;height:8px;border-radius:50%;background:#FF9800;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.6);"></div>`,
    iconSize: [8, 8],
    iconAnchor: [4, 4],
  });

  return (
    <>
      {segments.map((s, i) => (
        <React.Fragment key={i}>
          <Polyline positions={[s.a, s.b]} color="#FF9800" weight={2} opacity={0.9} />
          <Marker
            position={s.mid}
            icon={makeDistanceIcon(rulerLabel(s.a, s.b, s.dist))}
            interactive={false}
          />
        </React.Fragment>
      ))}
      {liveSeg && (
        <>
          <Polyline
            positions={[liveSeg.a, liveSeg.b]}
            color="#FF9800"
            weight={1.5}
            dashArray="6 5"
            opacity={0.8}
          />
          <Marker
            position={liveSeg.mid}
            icon={makeDistanceIcon(rulerLabel(liveSeg.a, liveSeg.b, liveSeg.dist))}
            interactive={false}
          />
        </>
      )}
      {points.map((p, i) => (
        <Marker key={`rp-${i}`} position={p} icon={dotIcon} interactive={false} />
      ))}
    </>
  );
}

/** Tracks cursor position for ruler live preview — must be mounted inside MapContainer. */
export function RulerCursorTracker({
  onMove,
}: {
  onMove: (pt: [number, number] | null) => void;
}): null {
  useMapEvents({
    mousemove(e) {
      onMove([e.latlng.lat, e.latlng.lng]);
    },
    mouseout() {
      onMove(null);
    },
  });
  return null;
}
