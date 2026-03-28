import { Marker, Popup } from "react-leaflet";
import type { Violation } from "../../types/mission";
import { makeViolationIcon } from "./icons";

interface MapViolationLayerProps {
  violations: Violation[];
}

const KIND_LABEL: Record<string, string> = {
  terrain_band: "Terrain band too narrow",
  slope: "Slope limit exceeded",
  vertical: "Below surface model",
  horizontal: "Safety bubble obstacle",
  surface_warning: "Above max AGL",
  camera_range: "Camera range exceeded",
};

export function MapViolationLayer({ violations }: MapViolationLayerProps) {
  if (!violations.length) return null;
  return (
    <>
      {violations.map((v, i) => (
        <Marker
          key={`viol-${i}`}
          position={[v.lat, v.lon]}
          icon={makeViolationIcon(v.category)}
        >
          <Popup>
            <div style={{ fontFamily: "sans-serif", fontSize: 12, minWidth: 160 }}>
              <b style={{ color: v.category === "safety" ? "#ff5252" : v.category === "product_poi" ? "#ff9100" : "#ffd600" }}>
                {KIND_LABEL[v.kind] ?? v.kind}
              </b>
              <div style={{ marginTop: 4, color: "#ccc" }}>{v.description}</div>
            </div>
          </Popup>
        </Marker>
      ))}
    </>
  );
}
