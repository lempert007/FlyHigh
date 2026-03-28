import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";

interface AutoFitProps {
  allLatLons: [number, number][];
  fitKey: number;
}

/** Auto-fits map bounds whenever the set of marker positions changes, or fitKey increments. */
export function AutoFit({ allLatLons, fitKey }: AutoFitProps): null {
  const map = useMap();
  const prevKey = useRef<string | null>(null);

  useEffect(() => {
    const key = JSON.stringify(allLatLons) + "|" + fitKey;
    if (key === prevKey.current) return;
    prevKey.current = key;
    if (allLatLons.length === 0) return;
    if (allLatLons.length === 1) {
      map.setView(allLatLons[0], map.getZoom());
    } else {
      map.fitBounds(allLatLons, { padding: [40, 40] });
    }
  }, [allLatLons, fitKey, map]);

  return null;
}
