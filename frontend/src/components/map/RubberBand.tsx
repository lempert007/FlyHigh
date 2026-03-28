import { useState } from "react";
import { Marker, Polyline, useMapEvents } from "react-leaflet";
import { haversineM, formatDist } from "../../utils/math";
import { makeDistanceIcon } from "./icons";

interface RubberBandProps {
  anchor: [number, number] | null;
}

/**
 * Rubber-band line from `anchor` to the live mouse cursor while placing a point.
 * Shows a dashed yellow line and a distance badge at the midpoint.
 */
export function RubberBand({ anchor }: RubberBandProps): React.ReactElement | null {
  const [cursor, setCursor] = useState<[number, number] | null>(null);

  useMapEvents({
    mousemove(e) { setCursor([e.latlng.lat, e.latlng.lng]); },
    mouseout()   { setCursor(null); },
  });

  if (!anchor || !cursor) return null;

  const mid: [number, number] = [(anchor[0] + cursor[0]) / 2, (anchor[1] + cursor[1]) / 2];
  const dist = haversineM(anchor, cursor);

  return (
    <>
      <Polyline
        positions={[anchor, cursor]}
        color="#FFD700"
        weight={1.5}
        dashArray="6 5"
        opacity={0.85}
      />
      <Marker position={mid} icon={makeDistanceIcon(formatDist(dist))} interactive={false} />
    </>
  );
}
