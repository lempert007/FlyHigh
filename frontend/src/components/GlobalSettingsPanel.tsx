import React, { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Collapse,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import CloseIcon from "@mui/icons-material/Close";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";

import { getPresets, isPresetsCustomised, savePresets, getSettings, saveSettings } from "../api";
import type { AppSettings, PresetItem } from "../types/mission";

// ── Types ─────────────────────────────────────────────────────────────────────

interface PresetRow extends PresetItem {
  _key: string;
}

let _rowCounter = 0;
function makeKey() {
  return `row-${++_rowCounter}`;
}
function toRows(presets: PresetItem[]): PresetRow[] {
  return presets.map((p) => ({ ...p, _key: makeKey() }));
}
function toItems(rows: PresetRow[]): PresetItem[] {
  return rows.map(({ _key: _k, ...rest }) => rest);
}

function validateRows(rows: PresetRow[]): string | null {
  if (rows.length === 0) return "At least one preset is required.";
  const names = rows.map((r) => r.name.trim().toLowerCase());
  if (new Set(names).size !== names.length) return "Preset names must be unique.";
  for (const r of rows) {
    if (!r.name.trim()) return "All preset names must be non-empty.";
    if (r.cruise_speed_ms <= 0) return `"${r.name}": cruise speed must be > 0.`;
    if (r.climb_rate_ms <= 0) return `"${r.name}": climb rate must be > 0.`;
    if (r.battery_wh <= 0) return `"${r.name}": battery capacity must be > 0.`;
    if (r.drone_weight_kg <= 0) return `"${r.name}": drone weight must be > 0.`;
  }
  return null;
}

// ── Shared field component ────────────────────────────────────────────────────

function NumField({
  value,
  unit,
  onChange,
  min = 0,
  step = "any",
  width = 120,
}: {
  value: number;
  unit: string;
  onChange: (v: number) => void;
  min?: number;
  step?: string;
  width?: number;
}) {
  return (
    <TextField
      size="small"
      type="number"
      value={value}
      onChange={(e) => {
        const n = parseFloat(e.target.value);
        if (!isNaN(n)) onChange(n);
      }}
      inputProps={{ min, step }}
      InputProps={{
        endAdornment: (
          <InputAdornment position="end">
            <Typography sx={{ fontSize: "0.72rem", color: "#6e7681" }}>{unit}</Typography>
          </InputAdornment>
        ),
      }}
      sx={{
        width,
        "& .MuiOutlinedInput-root": {
          bgcolor: "#161b22",
          fontSize: "0.82rem",
          color: "#cdd9e5",
          "& fieldset": { borderColor: "#30363d" },
          "&:hover fieldset": { borderColor: "#444c56" },
          "&.Mui-focused fieldset": { borderColor: "#1E90FF" },
        },
      }}
    />
  );
}

// ── Setting row (label + description on left, control on right) ───────────────

function SettingRow({
  label,
  desc,
  children,
}: {
  label: string;
  desc?: string;
  children: React.ReactNode;
}) {
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 2,
        py: 1.75,
        borderBottom: "1px solid #21262d",
        "&:last-child": { borderBottom: "none" },
      }}
    >
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography
          sx={{ fontSize: "0.82rem", color: "#cdd9e5", fontWeight: 500, lineHeight: 1.3 }}
        >
          {label}
        </Typography>
        {desc && (
          <Typography sx={{ fontSize: "0.72rem", color: "#6e7681", mt: 0.3, lineHeight: 1.4 }}>
            {desc}
          </Typography>
        )}
      </Box>
      {children}
    </Box>
  );
}

// ── Preset row editor ─────────────────────────────────────────────────────────

function PresetNumField({
  label,
  unit,
  value,
  onChange,
}: {
  label: string;
  unit: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <TextField
      label={label}
      size="small"
      type="number"
      value={value}
      onChange={(e) => {
        const n = parseFloat(e.target.value);
        if (!isNaN(n)) onChange(n);
      }}
      inputProps={{ min: 0, step: "any" }}
      InputProps={{
        endAdornment: (
          <InputAdornment position="end">
            <Typography sx={{ fontSize: "0.7rem", color: "#6e7681" }}>{unit}</Typography>
          </InputAdornment>
        ),
      }}
      sx={{
        flex: 1,
        minWidth: 110,
        "& .MuiOutlinedInput-root": {
          bgcolor: "#0d1117",
          fontSize: "0.8rem",
          color: "#cdd9e5",
          "& fieldset": { borderColor: "#30363d" },
          "&:hover fieldset": { borderColor: "#444c56" },
          "&.Mui-focused fieldset": { borderColor: "#1E90FF" },
        },
        "& .MuiInputLabel-root": { fontSize: "0.72rem", color: "#6e7681" },
        "& .MuiInputLabel-root.Mui-focused": { color: "#1E90FF" },
      }}
    />
  );
}

function OptionalNumField({
  label,
  unit,
  value,
  onChange,
}: {
  label: string;
  unit: string;
  value: number | null | undefined;
  onChange: (v: number | null) => void;
}) {
  return (
    <TextField
      label={label}
      size="small"
      type="number"
      value={value ?? ""}
      placeholder="—"
      onChange={(e) => {
        if (e.target.value === "") {
          onChange(null);
          return;
        }
        const n = parseFloat(e.target.value);
        if (!isNaN(n)) onChange(n);
      }}
      inputProps={{ min: 0, step: "any" }}
      InputProps={{
        endAdornment: (
          <InputAdornment position="end">
            <Typography sx={{ fontSize: "0.7rem", color: "#6e7681" }}>{unit}</Typography>
          </InputAdornment>
        ),
      }}
      sx={{
        flex: 1,
        minWidth: 110,
        "& .MuiOutlinedInput-root": {
          bgcolor: "#0d1117",
          fontSize: "0.8rem",
          color: "#cdd9e5",
          "& fieldset": { borderColor: "#30363d" },
          "&:hover fieldset": { borderColor: "#444c56" },
          "&.Mui-focused fieldset": { borderColor: "#1E90FF" },
        },
        "& .MuiInputLabel-root": { fontSize: "0.72rem", color: "#6e7681" },
        "& .MuiInputLabel-root.Mui-focused": { color: "#1E90FF" },
      }}
    />
  );
}

function PresetRowEditor({
  row,
  isOnly,
  onChange,
  onDelete,
}: {
  row: PresetRow;
  isOnly: boolean;
  onChange: (u: PresetRow) => void;
  onDelete: () => void;
}) {
  const [overridesOpen, setOverridesOpen] = useState(
    row.min_agl_m != null ||
      row.max_agl_m != null ||
      row.point_radius_m != null ||
      row.max_surface_radius_m != null ||
      row.spacing_m != null ||
      row.min_altitude_step_m != null
  );

  function field<K extends keyof PresetRow>(key: K) {
    return (val: PresetRow[K]) => onChange({ ...row, [key]: val });
  }

  const hasOverrides =
    row.min_agl_m != null ||
    row.max_agl_m != null ||
    row.point_radius_m != null ||
    row.max_surface_radius_m != null ||
    row.spacing_m != null ||
    row.min_altitude_step_m != null;

  return (
    <Box
      sx={{
        bgcolor: "#161b22",
        border: "1px solid #30363d",
        borderRadius: 1.5,
        p: 1.5,
        display: "flex",
        flexDirection: "column",
        gap: 1.5,
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <TextField
          placeholder="Preset name"
          size="small"
          value={row.name}
          onChange={(e) => onChange({ ...row, name: e.target.value })}
          sx={{
            flex: 1,
            "& .MuiOutlinedInput-root": {
              bgcolor: "#0d1117",
              fontSize: "0.82rem",
              fontWeight: 600,
              color: "#cdd9e5",
              "& fieldset": { borderColor: "#21262d" },
              "&:hover fieldset": { borderColor: "#444c56" },
              "&.Mui-focused fieldset": { borderColor: "#1E90FF" },
            },
          }}
        />
        <Tooltip title={isOnly ? "Cannot delete the last preset" : "Delete preset"}>
          <span>
            <IconButton
              size="small"
              onClick={onDelete}
              disabled={isOnly}
              sx={{
                color: "#f85149",
                opacity: isOnly ? 0.3 : 1,
                "&:hover": { bgcolor: "rgba(248,81,73,0.08)" },
              }}
            >
              <DeleteOutlineIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </span>
        </Tooltip>
      </Box>

      {/* Required fields */}
      <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
        <PresetNumField
          label="Cruise speed"
          unit="m/s"
          value={row.cruise_speed_ms}
          onChange={field("cruise_speed_ms")}
        />
        <PresetNumField
          label="Climb rate"
          unit="m/s"
          value={row.climb_rate_ms}
          onChange={field("climb_rate_ms")}
        />
        <PresetNumField
          label="Battery"
          unit="Wh"
          value={row.battery_wh}
          onChange={field("battery_wh")}
        />
        <PresetNumField
          label="Drone weight"
          unit="kg"
          value={row.drone_weight_kg}
          onChange={field("drone_weight_kg")}
        />
      </Box>

      {/* Optional flight config overrides */}
      <Box
        onClick={() => setOverridesOpen((v) => !v)}
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 0.5,
          cursor: "pointer",
          userSelect: "none",
          width: "fit-content",
        }}
      >
        <Typography
          variant="caption"
          sx={{ color: hasOverrides ? "#1E90FF" : "#6e7681", fontSize: "0.72rem" }}
        >
          Flight config overrides
        </Typography>
        <ExpandMoreIcon
          sx={{
            fontSize: 14,
            color: hasOverrides ? "#1E90FF" : "#6e7681",
            transform: overridesOpen ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.15s",
          }}
        />
      </Box>
      <Collapse in={overridesOpen}>
        <Typography
          variant="caption"
          sx={{ color: "#6e7681", fontSize: "0.68rem", display: "block", mb: 1 }}
        >
          Leave blank to use the global default. Values here are applied when the preset is
          selected.
        </Typography>
        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
          <OptionalNumField
            label="Min AGL"
            unit="m"
            value={row.min_agl_m}
            onChange={field("min_agl_m")}
          />
          <OptionalNumField
            label="Max AGL"
            unit="m"
            value={row.max_agl_m}
            onChange={field("max_agl_m")}
          />
          <OptionalNumField
            label="Safety radius"
            unit="m"
            value={row.point_radius_m}
            onChange={field("point_radius_m")}
          />
          <OptionalNumField
            label="Camera range"
            unit="m"
            value={row.max_surface_radius_m}
            onChange={field("max_surface_radius_m")}
          />
          <OptionalNumField
            label="Route resolution"
            unit="m"
            value={row.spacing_m}
            onChange={field("spacing_m")}
          />
          <OptionalNumField
            label="Min alt step"
            unit="m"
            value={row.min_altitude_step_m}
            onChange={field("min_altitude_step_m")}
          />
        </Box>
      </Collapse>
    </Box>
  );
}

// ── Tab styles matching the sidebar ──────────────────────────────────────────

const TAB_SX = {
  minHeight: 40,
  "& .MuiTab-root": {
    minHeight: 40,
    fontSize: "0.68rem",
    fontWeight: 700,
    letterSpacing: "0.09em",
    textTransform: "uppercase" as const,
    color: "#6e7681",
    "&.Mui-selected": { color: "#1E90FF" },
  },
  "& .MuiTabs-indicator": {
    height: 2,
    bgcolor: "#1E90FF",
    borderRadius: "2px 2px 0 0",
  },
};

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS: AppSettings = {
  default_min_agl_m: 15,
  default_max_agl_m: 80,
  default_spacing_m: 5,
  battery_warning_pct: 90,
  battery_error_pct: 100,
};

// ── Main panel ────────────────────────────────────────────────────────────────

interface GlobalSettingsPanelProps {
  open: boolean;
  onClose: () => void;
}

export function GlobalSettingsPanel({ open, onClose }: GlobalSettingsPanelProps) {
  const [tab, setTab] = useState(0);
  const [rows, setRows] = useState<PresetRow[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isCustomised, setIsCustomised] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [presets, customised, appSettings] = await Promise.all([
        getPresets(),
        isPresetsCustomised(),
        getSettings(),
      ]);
      setRows(toRows(presets));
      setIsCustomised(customised);
      setSettings(appSettings);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      setTab(0);
      loadAll();
    }
  }, [open, loadAll]);

  function handleRowChange(key: string, updated: PresetRow) {
    setRows((prev) => prev.map((r) => (r._key === key ? updated : r)));
    setValidationError(null);
  }

  function handleDelete(key: string) {
    setRows((prev) => prev.filter((r) => r._key !== key));
    setValidationError(null);
  }

  function handleAdd() {
    setRows((prev) => [
      ...prev,
      {
        _key: makeKey(),
        name: "New Preset",
        cruise_speed_ms: 10,
        climb_rate_ms: 3,
        battery_wh: 500,
        drone_weight_kg: 2.0,
      },
    ]);
  }

  function setSetting<K extends keyof AppSettings>(key: K, val: AppSettings[K]) {
    setSettings((prev) => ({ ...prev, [key]: val }));
    setValidationError(null);
  }

  async function handleSave() {
    {
      // validate all tabs on save
      const err = validateRows(rows);
      if (err) {
        setTab(2);
        setValidationError(err);
        return;
      }
    }
    if (settings.default_min_agl_m >= settings.default_max_agl_m) {
      setTab(0);
      setValidationError("Min AGL must be less than max AGL.");
      return;
    }
    if (settings.battery_warning_pct > settings.battery_error_pct) {
      setTab(1);
      setValidationError("Warning % must not exceed error %.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await Promise.all([savePresets(toItems(rows)), saveSettings(settings)]);
      setIsCustomised(true);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={() => !saving && onClose()}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          bgcolor: "#0d1117",
          border: "1px solid #30363d",
          boxShadow: "0 24px 64px rgba(0,0,0,0.8)",
          borderRadius: 2,
          display: "flex",
          flexDirection: "column",
        },
      }}
    >
      {/* Header */}
      <DialogTitle
        sx={{
          py: 1.5,
          px: 2.5,
          display: "flex",
          alignItems: "center",
          gap: 1,
          bgcolor: "#161b22",
          borderBottom: "1px solid #21262d",
          flexShrink: 0,
        }}
      >
        <Typography
          sx={{
            flex: 1,
            fontSize: "0.88rem",
            fontWeight: 700,
            color: "#cdd9e5",
            letterSpacing: "0.01em",
          }}
        >
          Settings
        </Typography>
        <IconButton
          size="small"
          onClick={onClose}
          disabled={saving}
          sx={{ color: "#6e7681", "&:hover": { color: "#cdd9e5" } }}
        >
          <CloseIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </DialogTitle>

      {/* Tab bar */}
      <Box sx={{ borderBottom: "1px solid #21262d", bgcolor: "#0f1318", flexShrink: 0 }}>
        <Tabs
          value={tab}
          onChange={(_, v: number) => {
            setTab(v);
            setValidationError(null);
          }}
          variant="fullWidth"
          sx={TAB_SX}
        >
          <Tab label="Defaults" />
          <Tab label="Warnings" />
          <Tab label="Presets" />
        </Tabs>
      </Box>

      {/* Content */}
      <DialogContent
        sx={{ p: 0, flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}
      >
        {/* Errors */}
        {(error || validationError) && (
          <Box sx={{ px: 2.5, pt: 2, flexShrink: 0 }}>
            {error && (
              <Alert
                severity="error"
                sx={{
                  mb: 1,
                  bgcolor: "rgba(248,81,73,0.08)",
                  border: "1px solid rgba(248,81,73,0.25)",
                  color: "#f85149",
                  fontSize: "0.78rem",
                  "& .MuiAlert-icon": { color: "#f85149" },
                }}
              >
                {error}
              </Alert>
            )}
            {validationError && (
              <Alert
                severity="warning"
                sx={{
                  mb: 1,
                  bgcolor: "rgba(210,153,34,0.08)",
                  border: "1px solid rgba(210,153,34,0.25)",
                  color: "#e3b341",
                  fontSize: "0.78rem",
                  "& .MuiAlert-icon": { color: "#e3b341" },
                }}
              >
                {validationError}
              </Alert>
            )}
          </Box>
        )}

        {loading ? (
          <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", flex: 1 }}>
            <CircularProgress size={24} sx={{ color: "#1E90FF" }} />
          </Box>
        ) : (
          <Box sx={{ flex: 1, overflowY: "auto", px: 2.5, pt: 1, pb: 2 }}>
            {/* ── Tab 0: Mission Defaults ── */}
            {tab === 0 && (
              <Box>
                <Box sx={{ mt: 1.5 }}>
                  <SettingRow
                    label="Min altitude (AGL)"
                    desc="Lowest the drone will fly above ground"
                  >
                    <NumField
                      value={settings.default_min_agl_m}
                      unit="m"
                      min={1}
                      onChange={(v) => setSetting("default_min_agl_m", v)}
                    />
                  </SettingRow>
                  <SettingRow
                    label="Max altitude (AGL)"
                    desc="Highest the drone will fly above ground"
                  >
                    <NumField
                      value={settings.default_max_agl_m}
                      unit="m"
                      min={1}
                      onChange={(v) => setSetting("default_max_agl_m", v)}
                    />
                  </SettingRow>
                  <SettingRow
                    label="Route point spacing"
                    desc="Distance between computed route waypoints"
                  >
                    <NumField
                      value={settings.default_spacing_m}
                      unit="m"
                      min={1}
                      onChange={(v) => setSetting("default_spacing_m", v)}
                    />
                  </SettingRow>
                </Box>
              </Box>
            )}

            {/* ── Tab 1: Safety & Warnings ── */}
            {tab === 1 && (
              <Box>
                <Box sx={{ mt: 1.5 }}>
                  <SettingRow
                    label="Battery warning"
                    desc="Budget % that triggers an amber warning"
                  >
                    <NumField
                      value={settings.battery_warning_pct}
                      unit="%"
                      min={0}
                      step="1"
                      onChange={(v) => setSetting("battery_warning_pct", v)}
                    />
                  </SettingRow>
                  <SettingRow label="Battery error" desc="Budget % that triggers a red error">
                    <NumField
                      value={settings.battery_error_pct}
                      unit="%"
                      min={0}
                      step="1"
                      onChange={(v) => setSetting("battery_error_pct", v)}
                    />
                  </SettingRow>
                </Box>
              </Box>
            )}

            {/* ── Tab 2: Drone Presets ── */}
            {tab === 2 && (
              <Box>
                {!isCustomised && (
                  <Alert
                    severity="info"
                    sx={{
                      mb: 2,
                      bgcolor: "rgba(30,144,255,0.06)",
                      border: "1px solid rgba(30,144,255,0.18)",
                      color: "#8b949e",
                      fontSize: "0.75rem",
                      "& .MuiAlert-icon": { color: "#1E90FF", fontSize: 16 },
                    }}
                  >
                    Using built-in defaults — saving will create a custom preset library.
                  </Alert>
                )}

                <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
                  {rows.map((row) => (
                    <PresetRowEditor
                      key={row._key}
                      row={row}
                      isOnly={rows.length === 1}
                      onChange={(updated) => handleRowChange(row._key, updated)}
                      onDelete={() => handleDelete(row._key)}
                    />
                  ))}
                  <Button
                    startIcon={<AddIcon sx={{ fontSize: "14px !important" }} />}
                    onClick={handleAdd}
                    size="small"
                    sx={{
                      textTransform: "none",
                      fontSize: "0.78rem",
                      color: "#6e7681",
                      border: "1px dashed #21262d",
                      borderRadius: 1.5,
                      py: 1,
                      "&:hover": {
                        borderColor: "#444c56",
                        color: "#cdd9e5",
                        bgcolor: "rgba(255,255,255,0.02)",
                      },
                    }}
                  >
                    Add preset
                  </Button>
                </Box>
              </Box>
            )}
          </Box>
        )}
      </DialogContent>

      {/* Footer */}
      <DialogActions
        sx={{
          px: 2.5,
          py: 1.75,
          gap: 1,
          bgcolor: "#161b22",
          borderTop: "1px solid #21262d",
          flexShrink: 0,
        }}
      >
        <Button
          onClick={onClose}
          disabled={saving}
          size="small"
          sx={{
            textTransform: "none",
            fontSize: "0.8rem",
            color: "#6e7681",
            "&:hover": { color: "#cdd9e5" },
          }}
        >
          Cancel
        </Button>
        <Button
          variant="contained"
          size="small"
          onClick={handleSave}
          disabled={saving || loading}
          startIcon={saving ? <CircularProgress size={11} color="inherit" /> : undefined}
          sx={{
            textTransform: "none",
            fontSize: "0.8rem",
            fontWeight: 600,
            boxShadow: "none",
            "&:hover": { boxShadow: "0 0 10px rgba(30,144,255,0.3)" },
          }}
        >
          {saving ? "Saving…" : "Save"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
