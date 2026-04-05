import { useCallback, useEffect, useState } from "react";
import {
  Box,
  Chip,
  CircularProgress,
  Collapse,
  Grid,
  IconButton,
  InputAdornment,
  Paper,
  Slider,
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
import { ManeuverType } from "../types/mission";
import type { Poi, SmartLawnmowerPreview } from "../types/mission";
import { previewStripSpacing } from "../api";

interface ManeuverCardProps {
  index: number;
  poi: Poi;
  globalMaxAgl: number;
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
  globalMaxAgl,
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
  const [preview, setPreview] = useState<SmartLawnmowerPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

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
  const isSmartLawnmower = maneuver.type === ManeuverType.SMART_LAWNMOWER;

  const fovDeg = maneuver.smart_fov_deg ?? 60;
  const overlap = maneuver.smart_overlap ?? 0.2;

  // Fetch strip spacing preview whenever smart_lawnmower params change
  useEffect(() => {
    if (!isSmartLawnmower) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    const altAgl = maneuver.poi_max_agl_m ?? globalMaxAgl;
    const areaWidth = maneuver.polygon ? undefined : maneuver.width_m;
    setPreviewLoading(true);
    previewStripSpacing(altAgl, fovDeg, overlap, areaWidth)
      .then((p) => {
        if (!cancelled) setPreview(p);
      })
      .catch(() => {
        if (!cancelled) setPreview(null);
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    isSmartLawnmower,
    fovDeg,
    overlap,
    maneuver.poi_max_agl_m,
    globalMaxAgl,
    maneuver.polygon,
    maneuver.width_m,
  ]);

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
            <ToggleButton value={ManeuverType.LAWNMOWER}>Lawnmower</ToggleButton>
            <ToggleButton value={ManeuverType.WARP_WEFT}>Warp & Weft</ToggleButton>
            <ToggleButton value={ManeuverType.SMART_LAWNMOWER}>Smart</ToggleButton>
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

        {/* ── Dimensions (lawnmower / warp_weft) ── */}
        {!isSmartLawnmower && !maneuver.polygon && (
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
        )}

        {!isSmartLawnmower && maneuver.polygon && (
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

        {/* ── Smart Lawnmower params ── */}
        {isSmartLawnmower && (
          <Box>
            {/* Area dimensions (no polygon) */}
            {!maneuver.polygon && (
              <Stack direction="row" alignItems="center" spacing={1} mb={1.5}>
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
              </Stack>
            )}

            {maneuver.polygon && (
              <Typography
                variant="caption"
                sx={{
                  color: "text.disabled",
                  cursor: "pointer",
                  "&:hover": { color: "error.main" },
                  display: "block",
                  mb: 1,
                }}
                onClick={() => updateManeuver("polygon", null)}
              >
                clear polygon
              </Typography>
            )}

            {/* FOV input */}
            <Stack direction="row" alignItems="center" spacing={1} mb={1}>
              <TextField
                size="small"
                type="number"
                label="Camera FOV"
                value={fovDeg}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  if (!isNaN(v) && v > 0 && v < 180) updateManeuver("smart_fov_deg", v);
                }}
                inputProps={{ step: 5, min: 10, max: 170 }}
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">
                      <Typography variant="caption" color="text.disabled">
                        °
                      </Typography>
                    </InputAdornment>
                  ),
                }}
                sx={{ width: 120 }}
              />
              <Box sx={{ flex: 1 }}>
                <Stack direction="row" justifyContent="space-between">
                  <Typography variant="caption" color="text.secondary">
                    Overlap
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {Math.round(overlap * 100)}%
                  </Typography>
                </Stack>
                <Slider
                  size="small"
                  value={overlap}
                  min={0}
                  max={0.75}
                  step={0.05}
                  onChange={(_, v) => updateManeuver("smart_overlap", v as number)}
                  sx={{ py: 0.5 }}
                />
              </Box>
            </Stack>

            {/* Live preview readout */}
            <Box
              sx={{
                bgcolor: "action.hover",
                borderRadius: 1,
                px: 1.25,
                py: 0.75,
                display: "flex",
                alignItems: "center",
                gap: 1,
                minHeight: 32,
              }}
            >
              {previewLoading ? (
                <CircularProgress size={14} sx={{ color: "text.disabled" }} />
              ) : preview ? (
                <>
                  <Typography variant="caption" color="text.secondary">
                    precise spacing {preview.precise_spacing_m} m
                  </Typography>
                  <Typography variant="caption" color="text.disabled">
                    ·
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    overlap spacing {preview.overlap_spacing_m} m
                  </Typography>
                  {preview.estimated_strips != null && (
                    <>
                      <Typography variant="caption" color="text.disabled">
                        ·
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        ~{preview.estimated_strips} strips
                      </Typography>
                    </>
                  )}
                  {preview.warning && (
                    <Chip
                      label="clamped"
                      size="small"
                      color="warning"
                      variant="outlined"
                      sx={{ height: 18, fontSize: "0.65rem" }}
                    />
                  )}
                </>
              ) : (
                <Typography variant="caption" color="text.disabled">
                  —
                </Typography>
              )}
            </Box>
          </Box>
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
