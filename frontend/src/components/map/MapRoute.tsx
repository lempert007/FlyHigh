/**
 * Route polylines, drone preview marker, and map-fit helpers rendered inside
 * the MapContainer.
 *
 * Handles three rendering modes:
 *  1. Flight preview active — splits route into flown (cyan) / unflown (orange)
 *  2. AGL profile available — colours segments by clearance margin
 *  3. Plain route — single orange polyline
 */

import { useEffect, useMemo } from "react";
import { Marker, Polyline, useMap } from "react-leaflet";
import type { LatLon, UploadResult } from "../../types/mission";
import type { FlightPreviewState } from "../../hooks/useFlightPreview";
import { makeDroneIcon } from "./icons";

// ── FitOnUpload ───────────────────────────────────────────────────────────────

interface FitOnUploadProps {
  uploadResult: UploadResult | null;
}

export function FitOnUpload({ uploadResult }: FitOnUploadProps) {
  const map = useMap();
  useEffect(() => {
    if (!uploadResult?.files?.length) return;
    const corners: [number, number][] = uploadResult.files.flatMap((f) => [
      [f.bbox[1], f.bbox[0]],
      [f.bbox[3], f.bbox[2]],
    ]);
    map.fitBounds(corners, { padding: [40, 40], animate: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadResult]);
  return null;
}

// ── splitRouteAtProgress ──────────────────────────────────────────────────────

function splitRouteAtProgress(
  points: [number, number][],
  progress: number,
): { flown: [number, number][]; unflown: [number, number][] } {
  if (points.length < 2 || progress <= 0) return { flown: [], unflown: points };
  if (progress >= 1) return { flown: points, unflown: [] };
  const dists = [0];
  for (let i = 1; i < points.length; i++) {
    const latMid = (points[i][0] + points[i - 1][0]) / 2;
    const dx = (points[i][0] - points[i - 1][0]) * 111320;
    const dy = (points[i][1] - points[i - 1][1]) * 111320 * Math.cos((latMid * Math.PI) / 180);
    dists.push(dists[i - 1] + Math.sqrt(dx * dx + dy * dy));
  }
  const total = dists[dists.length - 1];
  const target = progress * total;
  let i = 1;
  while (i < dists.length - 1 && dists[i] < target) i++;
  const segLen = dists[i] - dists[i - 1];
  const t = segLen > 0 ? (target - dists[i - 1]) / segLen : 0;
  const splitPt: [number, number] = [
    points[i - 1][0] + t * (points[i][0] - points[i - 1][0]),
    points[i - 1][1] + t * (points[i][1] - points[i - 1][1]),
  ];
  return {
    flown: [...points.slice(0, i), splitPt],
    unflown: [splitPt, ...points.slice(i)],
  };
}

// ── MapRoute ──────────────────────────────────────────────────────────────────

interface MapRouteProps {
  routeLeaflet: [number, number][];
  allLatLons: [number, number][];
  routeAglProfile?: number[];
  minAglM?: number;
  flightPreview?: FlightPreviewState;
}

export function MapRoute({ routeLeaflet, allLatLons, routeAglProfile, minAglM, flightPreview }: MapRouteProps) {
  const coloredSegments = useMemo(() => {
    if (!routeAglProfile || !minAglM || routeAglProfile.length !== routeLeaflet.length || routeLeaflet.length < 2) return null;
    const color = (agl: number) => (agl < minAglM ? "#ff5252" : agl < minAglM * 1.2 ? "#ff9100" : "#00e676");
    const segs: { positions: [number, number][]; color: string }[] = [];
    let run: [number, number][] = [routeLeaflet[0]];
    let runColor = color(routeAglProfile[0]);
    for (let i = 1; i < routeLeaflet.length; i++) {
      const c = color(routeAglProfile[i]);
      if (c !== runColor) {
        run.push(routeLeaflet[i]);
        if (run.length >= 2) segs.push({ positions: run, color: runColor });
        runColor = c;
        run = [routeLeaflet[i]];
      } else {
        run.push(routeLeaflet[i]);
      }
    }
    if (run.length >= 2) segs.push({ positions: run, color: runColor });
    return segs.length > 0 ? segs : null;
  }, [routeAglProfile, routeLeaflet, minAglM]);

  return (
    <>
      {/* Route lines */}
      {routeLeaflet.length > 1 && (() => {
        if (flightPreview?.isActive) {
          const { flown, unflown } = splitRouteAtProgress(routeLeaflet, flightPreview.progress);
          return (
            <>
              {unflown.length > 1 && <Polyline positions={unflown} color="#FF7043" weight={2.5} opacity={0.45} />}
              {flown.length > 1 && <Polyline positions={flown} color="#00E5FF" weight={3} opacity={0.95} />}
            </>
          );
        }
        if (coloredSegments) {
          return <>{coloredSegments.map((seg, i) => (
            <Polyline key={i} positions={seg.positions} color={seg.color} weight={2.5} opacity={0.85} />
          ))}</>;
        }
        return <Polyline positions={routeLeaflet} color="#FF7043" weight={2.5} opacity={0.85} />;
      })()}

      {/* Dashed preview line when no route planned yet */}
      {routeLeaflet.length === 0 && allLatLons.length > 1 && (
        <Polyline positions={allLatLons} color="#aaa" weight={1.5} dashArray="5 5" />
      )}

      {/* Drone marker during flight preview */}
      {flightPreview?.isActive && flightPreview.dronePosition && (() => {
        const bearingRounded = Math.round(flightPreview.droneBearing / 4) * 4;
        return (
          <Marker
            position={[flightPreview.dronePosition.lat, flightPreview.dronePosition.lon]}
            icon={makeDroneIcon(bearingRounded)}
            zIndexOffset={1000}
          />
        );
      })()}
    </>
  );
}
