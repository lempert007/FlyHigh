import { memo } from "react";
import { Polyline, Rectangle } from "react-leaflet";
import type { Poi } from "../../types/mission";

function mToLatLon(originLat: number, originLon: number, dx: number, dy: number): [number, number] {
  const dLat = dy / 111111;
  const dLon = dx / (111111 * Math.cos(originLat * Math.PI / 180));
  return [originLat + dLat, originLon + dLon];
}

interface ManeuverPreviewProps {
  poi: Poi;
}

/**
 * Renders the lawnmower / warp-weft maneuver preview:
 * a rectangle outline + individual sweep-strip lines.
 * Memoized so it only re-renders when the POI itself changes.
 */
export const ManeuverPreview = memo(function ManeuverPreview({ poi }: ManeuverPreviewProps) {
  const { point, maneuver } = poi;
  // Custom polygon already shown by SavedPolygonLayers — no rect preview needed.
  if (maneuver.polygon && maneuver.polygon.length > 0) return null;
  const { lat, lon } = point;
  const { width_m, height_m, sweep_spacing_m, type } = maneuver;
  const spacing = Math.max(sweep_spacing_m, 0.5);
  const toLL = (dx: number, dy: number) => mToLatLon(lat, lon, dx, dy);

  const sw = toLL(-width_m / 2, -height_m / 2);
  const ne = toLL(width_m / 2, height_m / 2);

  function vStrips(w: number, h: number) {
    const n = Math.max(1, Math.ceil(w / spacing));
    return Array.from({ length: n }, (_, i) => {
      const x = -w / 2 + spacing * (i + 0.5);
      return [toLL(x, -h / 2), toLL(x, h / 2)];
    });
  }

  function hStrips(w: number, h: number) {
    const n = Math.max(1, Math.ceil(h / spacing));
    return Array.from({ length: n }, (_, i) => {
      const y = -h / 2 + spacing * (i + 0.5);
      return [toLL(-w / 2, y), toLL(w / 2, y)];
    });
  }

  const allStrips = type === "warp_weft"
    ? [...vStrips(width_m, height_m), ...hStrips(width_m, height_m)]
    : vStrips(width_m, height_m);

  return (
    <>
      <Rectangle
        bounds={[sw, ne]}
        pathOptions={{ color: "#f44336", fillColor: "#f44336", fillOpacity: 0.05, weight: 2, dashArray: "5 4" }}
      />
      {allStrips.map((seg, i) => (
        <Polyline key={i} positions={seg as [number, number][]} color="#f44336" weight={1} opacity={0.45} dashArray="3 3" />
      ))}
    </>
  );
});
