import { useMapEvents } from "react-leaflet";
import type { LatLon } from "../../types/mission";

interface PolygonDrawHandlerProps {
  onVertex: (pt: LatLon) => void;
  onClose: () => void;
  vertexCount: number;
  onNotEnoughVertices: () => void;
}

/** Captures map clicks and double-clicks during polygon drawing mode. */
export function PolygonDrawHandler({
  onVertex,
  onClose,
  vertexCount,
  onNotEnoughVertices,
}: PolygonDrawHandlerProps): null {
  useMapEvents({
    click(e) {
      onVertex({ lat: e.latlng.lat, lon: e.latlng.lng });
    },
    dblclick(e) {
      e.originalEvent?.preventDefault();
      if (vertexCount < 3) {
        onNotEnoughVertices();
      } else {
        onClose();
      }
    },
  });
  return null;
}
