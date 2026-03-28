import React from "react";
import { Box, Typography } from "@mui/material";
import { Circle, Marker } from "react-leaflet";
import type { LatLon } from "../../types/mission";
import { makeColorIcon, makeDistanceIcon } from "./icons";

export interface RadiusCircle {
  id: number;
  lat: number;
  lon: number;
  radiusM: number;
}

interface RadiusLayerProps {
  circles: RadiusCircle[];
  pendingCenter: LatLon | null;
}

/** Map layer: committed radius circles + pending center pin. */
export function RadiusLayer({ circles, pendingCenter }: RadiusLayerProps) {
  return (
    <>
      {circles.map((c) => (
        <React.Fragment key={c.id}>
          <Circle
            center={[c.lat, c.lon]}
            radius={c.radiusM}
            pathOptions={{ color: "#ce93d8", fillColor: "#ce93d8", fillOpacity: 0.08, weight: 2 }}
          />
          <Marker
            position={[c.lat, c.lon]}
            icon={makeDistanceIcon(`r = ${c.radiusM >= 1000 ? (c.radiusM / 1000).toFixed(2) + " km" : c.radiusM + " m"}`)}
            interactive={false}
          />
        </React.Fragment>
      ))}
      {pendingCenter && (
        <Marker position={[pendingCenter.lat, pendingCenter.lon]} icon={makeColorIcon("#ce93d8", "R")} />
      )}
    </>
  );
}

interface RadiusInputPopupProps {
  pendingCenter: LatLon | null;
  pendingRadiusM: string;
  onChangeRadius: (v: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

/** DOM overlay: radius input popup that appears after placing a center point. */
export function RadiusInputPopup({ pendingCenter, pendingRadiusM, onChangeRadius, onConfirm, onCancel }: RadiusInputPopupProps) {
  if (!pendingCenter) return null;

  return (
    <Box sx={{
      position: "absolute", bottom: 40, left: "50%", transform: "translateX(-50%)",
      zIndex: 1100, bgcolor: "#161b22", border: "1px solid #ce93d8",
      borderRadius: 2, px: 2, py: 1.5, display: "flex", alignItems: "center", gap: 1,
    }}>
      <Typography sx={{ fontFamily: "monospace", fontSize: "0.75rem", color: "#ce93d8", whiteSpace: "nowrap" }}>
        Radius (m):
      </Typography>
      <Box
        component="input"
        autoFocus
        type="number"
        min="1"
        value={pendingRadiusM}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChangeRadius(e.target.value)}
        onKeyDown={(e: React.KeyboardEvent) => {
          if (e.key === "Enter") onConfirm();
          if (e.key === "Escape") onCancel();
        }}
        sx={{
          width: 90, bgcolor: "#0d1117", color: "#e6edf3", border: "1px solid #30363d",
          borderRadius: 1, px: 1, py: 0.5, fontFamily: "monospace", fontSize: "0.8rem",
          outline: "none", "&:focus": { borderColor: "#ce93d8" },
        }}
      />
      <Box
        component="button"
        onClick={onConfirm}
        sx={{ bgcolor: "#ce93d8", color: "#161b22", border: "none", borderRadius: 1, px: 1.5, py: 0.5, fontWeight: 700, fontSize: "0.75rem", cursor: "pointer", fontFamily: "monospace" }}
      >
        OK
      </Box>
      <Box
        component="button"
        onClick={onCancel}
        sx={{ bgcolor: "transparent", color: "#8b949e", border: "1px solid #30363d", borderRadius: 1, px: 1, py: 0.5, fontSize: "0.75rem", cursor: "pointer", fontFamily: "monospace" }}
      >
        ✕
      </Box>
    </Box>
  );
}
