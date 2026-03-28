import L from "leaflet";

// Fix default marker icons (Leaflet + Vite bundler issue)
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

export function makeColorIcon(color: string, label = ""): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<div style="
      background:${color};
      width:22px;height:22px;border-radius:50% 50% 50% 0;
      transform:rotate(-45deg);border:2px solid white;
      box-shadow:0 1px 4px rgba(0,0,0,0.5);
      display:flex;align-items:center;justify-content:center;">
      <span style="transform:rotate(45deg);color:white;font-size:9px;font-weight:bold;">${label}</span>
    </div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 22],
    popupAnchor: [0, -22],
  });
}

export function makeDistanceIcon(text: string): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<div style="
      background:rgba(0,0,0,0.65);
      color:#FFD700;
      font-size:11px;
      font-weight:600;
      font-family:monospace;
      padding:2px 6px;
      border-radius:4px;
      white-space:nowrap;
      pointer-events:none;
      border:1px solid rgba(255,215,0,0.4);
    ">${text}</div>`,
    iconSize: undefined,
    iconAnchor: [0, 0],
  });
}

export function makeVertexHandle(color: string): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<div style="
      width:12px;height:12px;border-radius:50%;
      background:${color};border:2px solid white;
      box-shadow:0 1px 4px rgba(0,0,0,0.5);
      cursor:grab;
    "></div>`,
    iconSize: [12, 12],
    iconAnchor: [6, 6],
  });
}

export const inProgressVertexIcon = makeVertexHandle("#FF9800");
export const savedVertexIcon = makeVertexHandle("#f44336");
export const startIcon = makeColorIcon("#4caf50", "H");
export const landIcon = makeColorIcon("#4caf50", "H");
export const waypointIcon = (n: number) => makeColorIcon("#2196f3", String(n));
export const poiIcon = (n: number) => makeColorIcon("#FF7043", `P${n}`);

export function makeViolationIcon(category: string): L.DivIcon {
  const color =
    category === "safety" ? "#ff5252" : category === "product_poi" ? "#ff9100" : "#ffd600";
  return L.divIcon({
    className: "",
    html: `<div style="
      width:18px;height:18px;border-radius:50%;
      background:${color};border:2px solid rgba(255,255,255,0.8);
      box-shadow:0 1px 6px rgba(0,0,0,0.6);
      display:flex;align-items:center;justify-content:center;
      font-size:11px;font-weight:bold;color:white;
      line-height:1;
    ">!</div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    popupAnchor: [0, -12],
  });
}

export function makeDroneIcon(bearing: number): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `
      <div style="position:relative;width:32px;height:32px;">
        <div style="
          position:absolute;inset:0;
          display:flex;align-items:center;justify-content:center;
          transform:rotate(${bearing}deg);
          filter:drop-shadow(0 0 4px #00E5FF);
        ">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-linecap="round" stroke-linejoin="round">
            <line x1="9.5" y1="9.5" x2="5" y2="5" stroke-width="1.6"/>
            <line x1="14.5" y1="9.5" x2="19" y2="5" stroke-width="1.6"/>
            <line x1="9.5" y1="14.5" x2="5" y2="19" stroke-width="1.6"/>
            <line x1="14.5" y1="14.5" x2="19" y2="19" stroke-width="1.6"/>
            <rect x="9.5" y="9.5" width="5" height="5" rx="1.2" stroke-width="1.6"/>
            <circle cx="4" cy="4" r="2.4" stroke-width="1.5"/>
            <circle cx="20" cy="4" r="2.4" stroke-width="1.5"/>
            <circle cx="4" cy="20" r="2.4" stroke-width="1.5"/>
            <circle cx="20" cy="20" r="2.4" stroke-width="1.5"/>
          </svg>
        </div>
      </div>
    `,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });
}
