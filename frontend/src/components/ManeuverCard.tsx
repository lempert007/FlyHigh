import { useCallback, useState } from "react";
import {
  Box,
  Collapse,
  Grid,
  IconButton,
  InputAdornment,
  Paper,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import CropFreeIcon from "@mui/icons-material/CropFree";
import DeleteIcon from "@mui/icons-material/Delete";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import MyLocationIcon from "@mui/icons-material/MyLocation";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import type { Poi } from "../types/mission";

interface ManeuverCardProps {
  index: number;
  poi: Poi;
  onChange: (index: number, updated: Poi) => void;
  onRemove: (index: number) => void;
  onActivatePlace: (index: number) => void;
  onActivatePolygonDraw: (index: number) => void;
  onDragStart: (index: number) => void;
  onDrop: (toIndex: number) => void;
}

export default function ManeuverCard({
  index,
  poi,
  onChange,
  onRemove,
  onActivatePlace,
  onActivatePolygonDraw,
  onDragStart,
  onDrop,
}: ManeuverCardProps) {
  const [aglOpen, setAglOpen] = useState(
    poi.maneuver.poi_min_agl_m != null || poi.maneuver.poi_max_agl_m != null
  );

  const updateName = useCallback(
    (val: string) => onChange(index, { ...poi, name: val }),
    [poi, onChange, index]
  );

  const updatePoint = useCallback(
    (field: "lat" | "lon", val: string) =>
      onChange(index, { ...poi, point: { ...poi.point, [field]: parseFloat(val) || 0 } }),
    [poi, onChange, index]
  );

  const updateManeuver = useCallback(
    (field: string, val: string | number | null) =>
      onChange(index, {
        ...poi,
        maneuver: {
          ...poi.maneuver,
          [field]:
            val === null ? null : typeof val === "string" ? val : parseFloat(String(val)) || 0,
        },
      }),
    [poi, onChange, index]
  );

  const { maneuver, point } = poi;
  const hasAglOverride = maneuver.poi_min_agl_m != null || maneuver.poi_max_agl_m != null;

  const mAdornment = (
    <InputAdornment position="end">
      <Typography variant="caption" color="text.disabled">
        m
      </Typography>
    </InputAdornment>
  );

  return (
    <Paper
      variant="outlined"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        onDragStart?.(index);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDrop?.(index);
      }}
      sx={{ cursor: "grab", "&:active": { cursor: "grabbing" } }}
    >
      {/* ── Header ── */}
      <Stack direction="row" alignItems="center" sx={{ pl: 1, pr: 0.5, pt: 1, pb: 0.75 }}>
        <DragIndicatorIcon sx={{ fontSize: 18, color: "text.disabled", flexShrink: 0, mr: 0.5 }} />
        <TextField
          size="small"
          variant="standard"
          value={poi.name || ""}
          onChange={(e) => updateName(e.target.value)}
          placeholder={`POI ${index + 1}`}
          inputProps={{ maxLength: 40 }}
          sx={{
            flex: 1,
            "& .MuiInput-input": { fontSize: "0.875rem", fontWeight: 600 },
            "& .MuiInput-underline:before": { borderColor: "transparent" },
            "& .MuiInput-underline:hover:before": { borderColor: "text.disabled" },
          }}
        />
        <Tooltip title="Remove">
          <IconButton
            size="small"
            onClick={() => onRemove(index)}
            sx={{ color: "text.disabled", "&:hover": { color: "error.main" } }}
          >
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>

      <Box sx={{ px: 1.5, pb: 1.5 }}>
        {/* ── Coordinates ── */}
        <Stack direction="row" alignItems="center" spacing={1} mb={1.5}>
          <TextField
            size="small"
            fullWidth
            label="Lat"
            type="number"
            value={point.lat}
            onChange={(e) => updatePoint("lat", e.target.value)}
            inputProps={{ step: 0.0001 }}
          />
          <TextField
            size="small"
            fullWidth
            label="Lon"
            type="number"
            value={point.lon}
            onChange={(e) => updatePoint("lon", e.target.value)}
            inputProps={{ step: 0.0001 }}
          />
          <Tooltip title="Place on map">
            <IconButton
              size="small"
              onClick={() => onActivatePlace(index)}
              sx={{ flexShrink: 0, color: "text.secondary", "&:hover": { color: "primary.main" } }}
            >
              <MyLocationIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>

        {/* ── Maneuver type + polygon draw ── */}
        <Stack direction="row" alignItems="center" justifyContent="space-between" mb={1.5}>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={maneuver.type}
            onChange={(_, v) => {
              if (v) updateManeuver("type", v);
            }}
            sx={{
              "& .MuiToggleButton-root": {
                textTransform: "none",
                fontSize: "0.75rem",
                px: 1.25,
                py: 0.4,
                borderColor: "divider",
                color: "text.secondary",
                "&.Mui-selected": { color: "text.primary", bgcolor: "action.selected" },
              },
            }}
          >
            <ToggleButton value="lawnmower">Lawnmower</ToggleButton>
            <ToggleButton value="warp_weft">Warp & Weft</ToggleButton>
          </ToggleButtonGroup>

          <Tooltip
            title={
              maneuver.polygon
                ? `${maneuver.polygon.length}-vertex polygon — click to redraw`
                : "Draw area on map"
            }
          >
            <IconButton
              size="small"
              onClick={() => onActivatePolygonDraw?.(index)}
              sx={{
                color: maneuver.polygon ? "primary.main" : "text.disabled",
                "&:hover": { color: "primary.main" },
              }}
            >
              <CropFreeIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>

        {/* ── Dimensions ── */}
        {!maneuver.polygon ? (
          <Stack direction="row" alignItems="center" spacing={1}>
            <TextField
              size="small"
              type="number"
              label="Width"
              value={maneuver.width_m}
              onChange={(e) => updateManeuver("width_m", e.target.value)}
              inputProps={{ step: 10, min: 10 }}
              InputProps={{ endAdornment: mAdornment }}
              sx={{ flex: 1 }}
            />
            <Typography color="text.disabled" sx={{ pb: 0.25 }}>
              ×
            </Typography>
            <TextField
              size="small"
              type="number"
              label="Height"
              value={maneuver.height_m}
              onChange={(e) => updateManeuver("height_m", e.target.value)}
              inputProps={{ step: 10, min: 10 }}
              InputProps={{ endAdornment: mAdornment }}
              sx={{ flex: 1 }}
            />
            <TextField
              size="small"
              type="number"
              label="Sweep"
              value={maneuver.sweep_spacing_m}
              onChange={(e) => updateManeuver("sweep_spacing_m", e.target.value)}
              inputProps={{ step: 1, min: 30 }}
              InputProps={{ endAdornment: mAdornment }}
              sx={{ flex: 1 }}
            />
          </Stack>
        ) : (
          <Stack direction="row" alignItems="center" spacing={1}>
            <TextField
              size="small"
              fullWidth
              type="number"
              label="Sweep"
              value={maneuver.sweep_spacing_m}
              onChange={(e) => updateManeuver("sweep_spacing_m", e.target.value)}
              inputProps={{ step: 1, min: 30 }}
              InputProps={{ endAdornment: mAdornment }}
            />
            <Typography
              variant="caption"
              noWrap
              sx={{
                color: "text.disabled",
                cursor: "pointer",
                "&:hover": { color: "error.main" },
                whiteSpace: "nowrap",
              }}
              onClick={() => updateManeuver("polygon", null)}
            >
              clear polygon
            </Typography>
          </Stack>
        )}

        {/* ── Height override ── */}
        <Stack
          direction="row"
          alignItems="center"
          spacing={0.5}
          onClick={() => setAglOpen((v) => !v)}
          sx={{ mt: 1.5, cursor: "pointer", width: "fit-content", userSelect: "none" }}
        >
          <Typography
            variant="caption"
            sx={{ color: hasAglOverride ? "primary.main" : "text.disabled" }}
          >
            Height override
          </Typography>
          <ExpandMoreIcon
            sx={{
              fontSize: 14,
              color: hasAglOverride ? "primary.main" : "text.disabled",
              transform: aglOpen ? "rotate(180deg)" : "rotate(0deg)",
              transition: "transform 0.2s",
            }}
          />
        </Stack>

        <Collapse in={aglOpen}>
          <Grid container spacing={1} sx={{ mt: 0.5 }}>
            <Grid item xs={6}>
              <TextField
                size="small"
                fullWidth
                type="number"
                label="Min AGL (m)"
                value={maneuver.poi_min_agl_m ?? ""}
                onChange={(e) =>
                  updateManeuver(
                    "poi_min_agl_m",
                    e.target.value === "" ? null : parseFloat(e.target.value)
                  )
                }
                inputProps={{ step: 5, min: 1 }}
                placeholder="global"
              />
            </Grid>
            <Grid item xs={6}>
              <TextField
                size="small"
                fullWidth
                type="number"
                label="Max AGL (m)"
                value={maneuver.poi_max_agl_m ?? ""}
                onChange={(e) =>
                  updateManeuver(
                    "poi_max_agl_m",
                    e.target.value === "" ? null : parseFloat(e.target.value)
                  )
                }
                inputProps={{ step: 5, min: 1 }}
                placeholder="global"
              />
            </Grid>
          </Grid>
        </Collapse>
      </Box>
    </Paper>
  );
}
