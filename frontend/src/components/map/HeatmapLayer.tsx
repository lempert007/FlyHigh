import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import "leaflet.heat";
import type { HeatLayer } from "leaflet.heat";
import L from "leaflet";

interface HeatmapLayerProps {
  /** Array of [lat, lon, intensity] tuples. Intensity is 0–1. */
  points: [number, number, number][];
}

/** Attaches a leaflet.heat heatmap layer to the parent react-leaflet map. */
export function HeatmapLayer({ points }: HeatmapLayerProps) {
  const map = useMap();
  const layerRef = useRef<HeatLayer | null>(null);

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const layer = (L as any).heatLayer(points, {
      radius: 35,
      blur: 20,
      maxZoom: 17,
      gradient: { 0.2: "#1E90FF", 0.5: "#00e5ff", 0.8: "#3fb950", 1.0: "#f85149" },
    }) as HeatLayer;
    layer.addTo(map);
    layerRef.current = layer;
    return () => {
      map.removeLayer(layer);
      layerRef.current = null;
    };
  }, [map, points]);

  return null;
}
