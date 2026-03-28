import { useMapEvents } from "react-leaflet";
import type { LatLon, PlaceMode } from "../../types/mission";

interface ClickHandlerProps {
  placeMode: PlaceMode;
  onPlacePoint: (pt: LatLon) => void;
  rulerMode: boolean;
  onRulerClick: (pt: [number, number]) => void;
  radiusMode: boolean;
  onRadiusClick: (pt: LatLon) => void;
}

/** Handles click-to-add behaviour based on the current active tool mode. */
export function ClickHandler({
  placeMode,
  onPlacePoint,
  rulerMode,
  onRulerClick,
  radiusMode,
  onRadiusClick,
}: ClickHandlerProps): null {
  useMapEvents({
    click(e) {
      if (rulerMode) {
        onRulerClick([e.latlng.lat, e.latlng.lng]);
      } else if (radiusMode) {
        onRadiusClick({ lat: e.latlng.lat, lon: e.latlng.lng });
      } else if (placeMode !== "none") {
        onPlacePoint({ lat: e.latlng.lat, lon: e.latlng.lng });
      }
    },
  });
  return null;
}
