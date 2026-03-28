import { Box, Paper, Slider, Stack, Tooltip, Typography } from "@mui/material";
import StraightenIcon from "@mui/icons-material/Straighten";
import type { ElevationOverlay, PlaceMode } from "../../types/mission";

interface MapToolbarProps {
  placeMode: PlaceMode;
  rulerMode: boolean;
  radiusMode: boolean;
  elevationOverlays: ElevationOverlay[];
  visibleOverlays: Set<string>;
  elevationOpacity: number;
  mapBottomPad: string;
  onSetPlaceMode: (mode: PlaceMode) => void;
  onToggleRuler: () => void;
  onToggleRadius: () => void;
  onFit: () => void;
  onElevationOpacity: (v: number) => void;
  onToggleOverlay: (filename: string) => void;
}

const PLACE_BUTTONS: { mode: PlaceMode; label: string; color: string; title: string }[] = [
  { mode: "start",    label: "Home",  color: "#4caf50", title: "Set home / landing point" },
  { mode: "waypoint", label: "+ WP",  color: "#2196f3", title: "Add transit waypoint" },
  { mode: "poi",      label: "+ POI", color: "#f44336", title: "Add point of interest" },
];

const TYPE_COLOR: Record<string, string> = { DSM: "#FF9800", DTM: "#4caf50" };

function shortName(filename: string, maxLen = 24): string {
  const base = filename.replace(/\.[^.]+$/, "");
  return base.length > maxLen ? base.slice(0, maxLen - 1) + "…" : base;
}

export function MapToolbar({
  placeMode, rulerMode, radiusMode, elevationOverlays, visibleOverlays, elevationOpacity, mapBottomPad,
  onSetPlaceMode, onToggleRuler, onToggleRadius, onFit, onElevationOpacity, onToggleOverlay,
}: MapToolbarProps) {
  const allVisible = elevationOverlays.every((o) => visibleOverlays.has(o.filename));
  const noneVisible = elevationOverlays.length > 0 && elevationOverlays.every((o) => !visibleOverlays.has(o.filename));

  return (
    <>
      {/* Tool buttons — top left */}
      <Box sx={{ position: "absolute", top: 10, left: 10, zIndex: 1000, display: "flex", flexDirection: "column", gap: 0.5 }}>
        <Paper elevation={3} sx={{ bgcolor: "#161b22", border: "1px solid #30363d", borderRadius: 1, overflow: "hidden" }}>
          <Stack>
            {PLACE_BUTTONS.map(({ mode, label, color, title }) => (
              <Tooltip key={mode} title={title} placement="right">
                <Box
                  onClick={() => onSetPlaceMode(placeMode === mode ? "none" : mode)}
                  sx={{
                    px: 1.5, py: 0.75, cursor: "pointer",
                    bgcolor: placeMode === mode ? color : "transparent",
                    color: placeMode === mode ? "white" : color,
                    fontSize: "0.72rem", fontWeight: 600, fontFamily: "monospace",
                    borderBottom: "1px solid #30363d", "&:last-child": { borderBottom: 0 },
                    "&:hover": { bgcolor: placeMode === mode ? color : "action.hover" },
                    transition: "all 0.15s",
                  }}
                >
                  {label}
                </Box>
              </Tooltip>
            ))}
          </Stack>
        </Paper>

        <Paper elevation={3} sx={{ bgcolor: "#161b22", border: "1px solid #30363d", borderRadius: 1, overflow: "hidden" }}>
          <Tooltip title={rulerMode ? "Exit measure mode (Esc)" : "Measure distances"} placement="right">
            <Box
              onClick={onToggleRuler}
              sx={{
                px: 1.5, py: 0.75, cursor: "pointer",
                bgcolor: rulerMode ? "#ff9100" : "transparent",
                color: rulerMode ? "white" : "#ff9100",
                fontSize: "0.72rem", fontWeight: 600, fontFamily: "monospace",
                "&:hover": { bgcolor: rulerMode ? "#ff9100" : "action.hover" },
                transition: "all 0.15s", display: "flex", alignItems: "center", gap: 0.5,
              }}
            >
              <StraightenIcon sx={{ fontSize: 14 }} /> Ruler
            </Box>
          </Tooltip>
        </Paper>

        <Paper elevation={3} sx={{ bgcolor: "#161b22", border: "1px solid #30363d", borderRadius: 1, overflow: "hidden" }}>
          <Tooltip title={radiusMode ? "Exit radius mode (Esc)" : "Place radius circle"} placement="right">
            <Box
              onClick={onToggleRadius}
              sx={{
                px: 1.5, py: 0.75, cursor: "pointer",
                bgcolor: radiusMode ? "#ce93d8" : "transparent",
                color: radiusMode ? "#161b22" : "#ce93d8",
                fontSize: "0.72rem", fontWeight: 600, fontFamily: "monospace",
                "&:hover": { bgcolor: radiusMode ? "#ce93d8" : "action.hover" },
                transition: "all 0.15s",
              }}
            >
              ⊙ Radius
            </Box>
          </Tooltip>
        </Paper>

        <Paper elevation={3} sx={{ bgcolor: "#161b22", border: "1px solid #30363d", borderRadius: 1, overflow: "hidden" }}>
          <Tooltip title="Fit map to route" placement="right">
            <Box
              onClick={onFit}
              sx={{
                px: 1.5, py: 0.75, cursor: "pointer", color: "#1E90FF",
                fontSize: "0.72rem", fontWeight: 600, fontFamily: "monospace",
                "&:hover": { bgcolor: "action.hover" }, transition: "all 0.15s",
              }}
            >
              Fit
            </Box>
          </Tooltip>
        </Paper>
      </Box>

      {/* Terrain panel — bottom left (only when overlays exist) */}
      {elevationOverlays.length > 0 && (
        <Box sx={{
          position: "absolute", bottom: mapBottomPad, left: 10, zIndex: 1000,
          transition: "bottom 0.3s", minWidth: 170, overflow: "hidden",
          bgcolor: "rgba(22,27,34,0.93)", border: "1px solid #30363d", borderRadius: "6px",
        }}>
          {/* Header */}
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", px: 1.25, pt: 0.75, pb: 0.5 }}>
            <Typography sx={{ fontSize: "0.58rem", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#484f58", fontFamily: "monospace" }}>
              Terrain
            </Typography>
            {elevationOverlays.length > 1 && (
              <Tooltip title={allVisible ? "Hide all" : "Show all"}>
                <Box
                  onClick={() => {
                    if (allVisible) {
                      elevationOverlays.forEach((o) => { if (visibleOverlays.has(o.filename)) onToggleOverlay(o.filename); });
                    } else {
                      elevationOverlays.forEach((o) => { if (!visibleOverlays.has(o.filename)) onToggleOverlay(o.filename); });
                    }
                  }}
                  sx={{
                    fontSize: "0.58rem", cursor: "pointer", userSelect: "none",
                    color: "#484f58", fontFamily: "monospace",
                    "&:hover": { color: "#8b949e" },
                    transition: "color 0.15s",
                  }}
                >
                  {allVisible ? "hide all" : "show all"}
                </Box>
              </Tooltip>
            )}
          </Box>

          {/* Divider */}
          <Box sx={{ height: "1px", bgcolor: "#21262d", mx: 1.25 }} />

          {/* Per-layer rows */}
          <Box sx={{ px: 1, py: 0.5 }}>
            {elevationOverlays.map((ov) => {
              const visible = visibleOverlays.has(ov.filename);
              const typeColor = TYPE_COLOR[ov.type] ?? "#8b949e";
              return (
                <Tooltip key={ov.filename} title={`${ov.filename} — click to ${visible ? "hide" : "show"}`} placement="right">
                  <Box
                    onClick={() => onToggleOverlay(ov.filename)}
                    sx={{
                      display: "flex", alignItems: "center", gap: 0.75,
                      cursor: "pointer", borderRadius: "4px", px: 0.5, py: 0.35,
                      opacity: visible ? 1 : 7,
                      "&:hover": { bgcolor: "rgba(255,255,255,0.04)", opacity: 1 },
                      transition: "opacity 0.15s",
                    }}
                  >
                    <Box sx={{
                      width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
                      bgcolor: visible ? typeColor : "#30363d",
                      boxShadow: visible ? `0 0 4px ${typeColor}aa` : "none",
                      transition: "all 0.15s",
                    }} />
                    <Box sx={{ fontSize: "0.55rem", fontWeight: 700, fontFamily: "monospace", lineHeight: 1, flexShrink: 0, color: visible ? typeColor : "#30363d" }}>
                      {ov.type}
                    </Box>
                    <Typography sx={{
                      fontSize: "0.63rem", fontFamily: "monospace",
                      color: visible ? "#c9d1d9" : "#484f58",
                      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                      maxWidth: 130, lineHeight: 1,
                      transition: "color 0.15s",
                    }}>
                      {shortName(ov.filename)}
                    </Typography>
                  </Box>
                </Tooltip>
              );
            })}
          </Box>

          {/* Divider */}
          <Box sx={{ height: "1px", bgcolor: "#21262d", mx: 1.25 }} />

          {/* Opacity slider — flush in its own section */}
          <Box sx={{ px: 1.5, pt: 1, pb: 2  }}>
            <Slider
              size="small" min={0} max={1} step={0.05}
              value={elevationOpacity}
              onChange={(_, v) => onElevationOpacity(v as number)}
              sx={{
                display: "block", p: 0, height: 2,
                "& .MuiSlider-thumb": {
                  width: 10, height: 10,
                  bgcolor: "#8b949e", border: "none",
                  boxShadow: "none",
                  "&:hover, &.Mui-focusVisible": { boxShadow: "0 0 0 6px rgba(139,148,158,0.16)" },
                },
                "& .MuiSlider-track": { bgcolor: "#8b949e", border: "none", height: 2 },
                "& .MuiSlider-rail": { bgcolor: "#30363d", height: 2, opacity: 1 },
              }}
            />
          </Box>
        </Box>
      )}
    </>
  );
}
