import { useCallback, useMemo } from "react";
import {
  Accordion, AccordionDetails, AccordionSummary,
  Box, Checkbox, Chip, FormControlLabel, Grid, InputAdornment, Paper, Stack, TextField, Tooltip, Typography,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import BatteryFullIcon from "@mui/icons-material/BatteryFull";
import SpeedIcon from "@mui/icons-material/Speed";
import TerrainIcon from "@mui/icons-material/Terrain";
import TuneIcon from "@mui/icons-material/Tune";
import type { FlightConfig } from "../types/mission";
import type { DronePreset } from "../dronePresets";

interface NumField {
  key: keyof FlightConfig;
  label: string;
  unit: string;
  min: number;
  help: string;
}

const NUM_FIELDS: NumField[] = [
  { key: "min_agl_m",           label: "Min flight height",  unit: "m",   min: 1,    help: "Lowest the drone may fly above the ground (global default)" },
  { key: "max_agl_m",           label: "Max flight height",  unit: "m",   min: 1,    help: "Highest allowed AGL — overridable per POI" },
  { key: "point_radius_m",      label: "Safety radius",      unit: "m",   min: 0,    help: "Hard obstacle-avoidance bubble — HARD violation if anything within this radius exceeds drone altitude. Typically larger than camera range." },
  { key: "max_surface_radius_m", label: "Camera range",      unit: "m",   min: 0,    help: "HARD check: drone must not exceed max AGL above the lowest surface within this radius. Typically smaller than safety radius." },
  { key: "min_altitude_step_m", label: "Min altitude step",  unit: "m",   min: 0,    help: "Ignore altitude drops smaller than this value — fly flat at the higher altitude instead. 0 = tightest terrain following." },
  { key: "cruise_speed_ms",     label: "Cruise speed",       unit: "m/s", min: 0.1,  help: "Horizontal speed during transit" },
  { key: "climb_rate_ms",       label: "Max climb rate",     unit: "m/s", min: 0.1,  help: "Maximum vertical speed" },
  { key: "spacing_m",           label: "Route resolution",   unit: "m",   min: 1,    help: "Distance between computed route points" },
  { key: "battery_wh",          label: "Battery capacity",   unit: "Wh",  min: 1,    help: "Total available energy" },
  { key: "drone_weight_kg",     label: "Drone weight",       unit: "kg",  min: 0.01, help: "Used for energy estimation" },
];

interface FlightConfigPanelProps {
  config: FlightConfig;
  onChange: (cfg: FlightConfig) => void;
  stepDone: boolean;
  presets?: DronePreset[];
  onFieldFocus?: () => void;
  availableTerrainTypes?: ("DSM" | "DTM")[];
}

/** Small DSM / DTM pill toggle row shown beneath a field when both terrain types are loaded. */
function TerrainToggle({
  value,
  onChange,
}: {
  value: "DSM" | "DTM";
  onChange: (v: "DSM" | "DTM") => void;
}) {
  return (
    <Stack direction="row" spacing={0.5} mt={0.5}>
      {(["DSM", "DTM"] as const).map((opt) => {
        const active = value === opt;
        return (
          <Box
            key={opt}
            onClick={() => onChange(opt)}
            sx={{
              px: 0.75, py: 0.2,
              borderRadius: "4px",
              border: "1px solid",
              borderColor: active ? "#1E90FF" : "#30363d",
              bgcolor: active ? "rgba(30,144,255,0.15)" : "transparent",
              color: active ? "#1E90FF" : "#6e7681",
              fontSize: "0.62rem",
              fontWeight: 700,
              letterSpacing: "0.05em",
              cursor: "pointer",
              userSelect: "none",
              transition: "all 0.12s",
              "&:hover": {
                borderColor: active ? "#1E90FF" : "#58a6ff",
                color: active ? "#1E90FF" : "#58a6ff",
              },
            }}
          >
            {opt}
          </Box>
        );
      })}
    </Stack>
  );
}

export default function FlightConfigPanel({
  config, onChange, stepDone, presets = [], onFieldFocus,
  availableTerrainTypes = [],
}: FlightConfigPanelProps) {
  const showTerrainToggles = availableTerrainTypes.includes("DSM") && availableTerrainTypes.includes("DTM");

  const handleNum = useCallback(
    (key: keyof FlightConfig) => (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = parseFloat(e.target.value);
      if (!isNaN(val)) onChange({ ...config, [key]: val });
    },
    [config, onChange]
  );

  const fieldError = useCallback(
    (key: keyof FlightConfig, min: number) => {
      if ((config[key] as number) < min) return true;
      if (key === "max_agl_m" && config.max_agl_m <= config.min_agl_m) return true;
      return false;
    },
    [config]
  );

  const fieldHelperText = useCallback(
    (key: keyof FlightConfig, min: number): string | undefined => {
      if ((config[key] as number) < min) return `Must be ≥ ${min}`;
      if (key === "max_agl_m" && config.max_agl_m <= config.min_agl_m) return "Must exceed min AGL";
      return undefined;
    },
    [config]
  );

  const handleBool = useCallback(
    (key: keyof FlightConfig) => (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange({ ...config, [key]: e.target.checked });
    },
    [config, onChange]
  );

  const activePreset = useMemo(() => {
    for (const preset of presets) {
      if (Object.entries(preset.config).every(([k, v]) => config[k as keyof FlightConfig] === v)) return preset.label;
    }
    return "Custom";
  }, [config, presets]);

  /** Render a single numeric field, optionally with a terrain toggle beneath it. */
  function renderNumField({ key, label, unit, help, min }: NumField) {
    const terrainKey =
      key === "point_radius_m" ? "safety_radius_terrain" as const :
      key === "max_surface_radius_m" ? "camera_range_terrain" as const :
      null;

    return (
      <Grid item xs={6} key={key}>
        <Tooltip title={help} placement="top">
          <TextField
            size="small" fullWidth label={`${label} (${unit})`} type="number"
            value={config[key] ?? ""}
            onChange={handleNum(key)}
            onFocus={onFieldFocus}
            error={fieldError(key, min)}
            helperText={fieldHelperText(key, min)}
            inputProps={{ step: key.includes("speed") || key.includes("rate") ? 0.5 : 1, min }}
          />
        </Tooltip>
        {showTerrainToggles && terrainKey && (
          <TerrainToggle
            value={config[terrainKey]}
            onChange={(v) => onChange({ ...config, [terrainKey]: v })}
          />
        )}
      </Grid>
    );
  }

  return (
    <Paper elevation={2} sx={{ p: 2 }} data-tutorial="flight-config">
      <Stack direction="row" alignItems="center" spacing={1} mb={1}>
        <Box sx={{
          width: 22, height: 22, borderRadius: "50%",
          display: "flex", alignItems: "center", justifyContent: "center",
          bgcolor: stepDone ? "success.main" : "primary.main",
          fontSize: "0.65rem", fontWeight: 700, color: "white",
          boxShadow: stepDone ? "0 0 8px rgba(76,175,80,0.6)" : "0 0 8px rgba(30,144,255,0.4)",
          transition: "all 0.3s", flexShrink: 0,
        }}>
          {stepDone ? "✓" : "3"}
        </Box>
        <Typography variant="subtitle2" fontWeight={600}>Flight Parameters</Typography>
      </Stack>

      {presets.length > 0 && (
        <Box sx={{ mb: 1.5 }}>
          <Typography variant="caption" color="text.secondary" display="block" mb={0.5}>Drone preset</Typography>
          <Stack direction="row" flexWrap="wrap" gap={0.5}>
            {[...presets, null].map((preset) => {
              const name = preset ? preset.label : "Custom";
              return (
                <Chip
                  key={name}
                  label={name}
                  size="small"
                  variant={activePreset === name ? "filled" : "outlined"}
                  color={activePreset === name ? "primary" : "default"}
                  onClick={preset ? () => onChange({ ...config, ...preset.config }) : undefined}
                  sx={{ fontSize: "0.7rem", cursor: preset ? "pointer" : "default" }}
                />
              );
            })}
          </Stack>
        </Box>
      )}

      <Accordion disableGutters defaultExpanded>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Stack direction="row" alignItems="center" spacing={0.75}>
            <TerrainIcon fontSize="small" sx={{ color: "text.secondary" }} />
            <Typography variant="body2" fontWeight={500}>Altitude &amp; Safety</Typography>
          </Stack>
        </AccordionSummary>
        <AccordionDetails>
          <Grid container spacing={1}>
            {NUM_FIELDS.slice(0, 5).map(renderNumField)}
          </Grid>
        </AccordionDetails>
      </Accordion>

      <Accordion disableGutters>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Stack direction="row" alignItems="center" spacing={0.75}>
            <SpeedIcon fontSize="small" sx={{ color: "text.secondary" }} />
            <Typography variant="body2" fontWeight={500}>Performance</Typography>
          </Stack>
        </AccordionSummary>
        <AccordionDetails>
          <Grid container spacing={1}>
            {NUM_FIELDS.slice(5, 8).map(({ key, label, unit, help, min }) => (
              <Grid item xs={6} key={key}>
                <Tooltip title={help} placement="top">
                  <TextField
                    size="small" fullWidth label={`${label} (${unit})`} type="number"
                    value={config[key] ?? ""}
                    onChange={handleNum(key)}
                    onFocus={onFieldFocus}
                    error={fieldError(key, min)}
                    helperText={fieldHelperText(key, min)}
                    inputProps={{ step: 0.5, min }}
                  />
                </Tooltip>
              </Grid>
            ))}
            {/* Max slope ratio — 1:X format */}
            <Grid item xs={6}>
              {(() => {
                const autoRatio = config.climb_rate_ms / config.cruise_speed_ms;
                const autoDenom = Math.round(1 / autoRatio);
                const activeDenom = config.max_slope_ratio !== null ? Math.round(1 / config.max_slope_ratio) : null;
                const deg = (Math.atan(config.max_slope_ratio ?? autoRatio) * 180 / Math.PI).toFixed(1);
                return (
                  <Tooltip title="Max ramp steepness — 1 m up per X m forward. Blank = auto from climb rate ÷ speed." placement="top">
                    <TextField
                      size="small" fullWidth label="Max slope (1 : X)"
                      type="number"
                      value={activeDenom ?? ""}
                      placeholder={String(autoDenom)}
                      onFocus={onFieldFocus}
                      onChange={(e) => {
                        if (e.target.value === "") { onChange({ ...config, max_slope_ratio: null }); return; }
                        const x = parseFloat(e.target.value);
                        if (!isNaN(x) && x >= 1) onChange({ ...config, max_slope_ratio: 1 / x });
                      }}
                      inputProps={{ step: 1, min: 1 }}
                      InputProps={{ endAdornment: <InputAdornment position="end"><Typography sx={{ fontSize: "0.7rem", color: "text.disabled", fontFamily: "monospace", whiteSpace: "nowrap" }}>{deg}°</Typography></InputAdornment> }}
                    />
                  </Tooltip>
                );
              })()}
            </Grid>
          </Grid>
        </AccordionDetails>
      </Accordion>

      <Accordion disableGutters>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Stack direction="row" alignItems="center" spacing={0.75}>
            <BatteryFullIcon fontSize="small" sx={{ color: "text.secondary" }} />
            <Typography variant="body2" fontWeight={500}>Battery &amp; Weight</Typography>
          </Stack>
        </AccordionSummary>
        <AccordionDetails>
          <Grid container spacing={1}>
            {NUM_FIELDS.slice(8).map(({ key, label, unit, help, min }) => (
              <Grid item xs={6} key={key}>
                <Tooltip title={help} placement="top">
                  <TextField
                    size="small" fullWidth label={`${label} (${unit})`} type="number"
                    value={config[key] ?? ""}
                    onChange={handleNum(key)}
                    onFocus={onFieldFocus}
                    error={fieldError(key, min)}
                    helperText={fieldHelperText(key, min)}
                    inputProps={{ step: 0.1, min }}
                  />
                </Tooltip>
              </Grid>
            ))}
          </Grid>
        </AccordionDetails>
      </Accordion>

      <Accordion disableGutters>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Stack direction="row" alignItems="center" spacing={0.75}>
            <TuneIcon fontSize="small" sx={{ color: "text.secondary" }} />
            <Typography variant="body2" fontWeight={500}>Advanced</Typography>
          </Stack>
        </AccordionSummary>
        <AccordionDetails>
          <Tooltip title="Reorder POIs using a greedy nearest-neighbor algorithm to minimise total transit distance. Has no effect with fewer than 3 POIs." placement="top">
            <FormControlLabel
              control={<Checkbox size="small" checked={!!config.optimize_poi_order} onChange={handleBool("optimize_poi_order")} />}
              label={<Typography variant="body2">Optimize visit order (nearest-neighbor)</Typography>}
            />
          </Tooltip>
          <Tooltip title="Shift transit legs sideways to seek flatter terrain before altitude optimisation. Reduces unnecessary height changes at the cost of slightly longer planning time." placement="top">
            <FormControlLabel
              control={<Checkbox size="small" checked={!!config.smart_route} onChange={handleBool("smart_route")} />}
              label={<Typography variant="body2">Smart Route — lateral path optimisation</Typography>}
            />
          </Tooltip>
          {config.smart_route && (
            <Tooltip title="Maximum sideways offset the optimizer may try per transit segment." placement="top">
              <TextField
                size="small" fullWidth label="Max lateral offset (m)" type="number"
                value={config.smart_route_corridor_m}
                onChange={handleNum("smart_route_corridor_m")}
                onFocus={onFieldFocus}
                error={config.smart_route_corridor_m <= 0}
                helperText={config.smart_route_corridor_m <= 0 ? "Must be > 0" : undefined}
                inputProps={{ step: 10, min: 1 }}
                sx={{ mt: 1 }}
              />
            </Tooltip>
          )}
        </AccordionDetails>
      </Accordion>
    </Paper>
  );
}
