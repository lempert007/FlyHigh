import React, { useState } from "react";
import {
  Alert, Box, Button, CircularProgress, IconButton,
  Menu, MenuItem, Paper, Stack, TextField, Tooltip, Typography,
} from "@mui/material";
import SaveIcon from "@mui/icons-material/Save";
import DownloadIcon from "@mui/icons-material/Download";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import UndoIcon from "@mui/icons-material/Undo";
import RedoIcon from "@mui/icons-material/Redo";
import TerrainIcon from "@mui/icons-material/Terrain";
import PlaceIcon from "@mui/icons-material/Place";
import RouteIcon from "@mui/icons-material/Route";
import GpsFixedIcon from "@mui/icons-material/GpsFixed";
import CloseIcon from "@mui/icons-material/Close";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import type { LatLon, Waypoint, Poi, InteractionState, InteractionMode, UploadResult, MissionStatus } from "../../types/mission";
import type { LiveEstimates } from "../../hooks/useLiveEstimates";
import UploadPanel from "../UploadPanel";
import { StartPointSection } from "./StartPointSection";
import { PoiSection } from "./PoiSection";
import { LiveEstimatesBar } from "./LiveEstimatesBar";

const STATUS_OPTIONS: { value: MissionStatus; label: string; color: string }[] = [
  { value: "draft", label: "Draft", color: "#8b949e" },
  { value: "ready", label: "Ready", color: "#3fb950" },
  { value: "flown", label: "Flown", color: "#1E90FF" },
];

export interface MissionTabProps {
  // Identity
  missionName: string;
  missionNotes: string;
  onNameChange: (v: string) => void;
  onNotesChange: (v: string) => void;
  /** Save to backend */
  onSave: () => Promise<void>;
  isSaving: boolean;
  saveError: string | null;
  isDirty: boolean;
  /** Export to JSON file */
  onExport: () => Promise<void>;
  onLoad: (e: React.ChangeEvent<HTMLInputElement>) => void;
  loadRouteError: string | null;
  onClearLoadRouteError: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;

  // Status
  status: MissionStatus;
  onStatusChange: (s: MissionStatus) => void;

  // Navigation
  onBack: () => void;

  // Upload
  uploadResult: UploadResult | null;
  elevationErrors: Record<string, string>;
  onUploadSuccess: (r: UploadResult) => void;
  onUploadClear: () => void;

  // Takeoff
  takeoffMode: "auto" | "fixed";
  takeoffAltM: number;
  onTakeoffModeChange: (mode: "auto" | "fixed") => void;
  onTakeoffAltChange: (v: number) => void;

  // Points & maneuvers
  start: LatLon | null;
  waypoints: Waypoint[];
  pois: Poi[];
  interaction: InteractionState;
  onSetPlaceMode: (mode: InteractionMode) => void;
  onRemoveWaypoint: (i: number) => void;
  onWaypointNameChange: (i: number, name: string) => void;
  onPoiChange: (i: number, poi: Poi) => void;
  onPoiRemove: (i: number) => void;
  onPoiActivatePlace: (i: number) => void;
  onActivatePolygonDraw: (i: number) => void;
  onPoiDragStart: (i: number) => void;
  onPoiDrop: (i: number) => void;
  onAddPoi: () => void;

  // Live estimates
  liveEstimates: LiveEstimates | null;
}

/** Left-border accent: grey idle, blue in-progress, green done. */
function cardSx(done: boolean, active = false) {
  const accent = done ? "#00e676" : active ? "#1E90FF" : "#30363d";
  return {
    border: "1px solid #21262d",
    borderLeft: `3px solid ${accent}`,
    borderRadius: 2,
    p: 2,
    bgcolor: "#0f1318",
  } as const;
}

/** Minimal card header: icon + label. Left border carries the status. */
function CardHeader({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <Stack direction="row" alignItems="center" spacing={1} mb={1.5}>
      <Box sx={{ color: "text.disabled", display: "flex", flexShrink: 0 }}>{icon}</Box>
      <Typography
        variant="caption"
        sx={{ textTransform: "uppercase", letterSpacing: "0.07em", fontSize: "0.67rem", fontWeight: 700, color: "text.disabled" }}
      >
        {label}
      </Typography>
    </Stack>
  );
}

export function MissionTab(props: MissionTabProps) {
  const {
    missionName, missionNotes, onNameChange, onNotesChange,
    onSave, isSaving, saveError, isDirty,
    onExport, onLoad, loadRouteError, onClearLoadRouteError,
    canUndo, canRedo, onUndo, onRedo,
    status, onStatusChange, onBack,
    uploadResult, elevationErrors, onUploadSuccess, onUploadClear,
    takeoffMode, takeoffAltM, onTakeoffModeChange, onTakeoffAltChange,
    start, waypoints, pois, interaction,
    onSetPlaceMode, onRemoveWaypoint, onWaypointNameChange,
    onPoiChange, onPoiRemove, onPoiActivatePlace, onActivatePolygonDraw,
    onPoiDragStart, onPoiDrop, onAddPoi,
    liveEstimates,
  } = props;

  const placeMode = interaction.mode === "polygon" ? "none" : interaction.mode;
  const statusColor = STATUS_OPTIONS.find((o) => o.value === status)?.color ?? "#8b949e";
  const [statusAnchor, setStatusAnchor] = useState<null | HTMLElement>(null);

  return (
    <>
      {loadRouteError && (
        <Alert severity="error" sx={{ py: 0.5 }} onClose={onClearLoadRouteError}>
          {loadRouteError}
        </Alert>
      )}
      {saveError && (
        <Alert severity="error" sx={{ py: 0.5 }}>{saveError}</Alert>
      )}

      {/* Mission Details */}
      <Paper elevation={0} sx={cardSx(false)}>
        {/* Toolbar row */}
        <Stack direction="row" alignItems="center" spacing={0.5} mb={1}>
          <Tooltip title="Back to missions">
            <IconButton size="small" onClick={onBack} sx={{ color: "text.disabled" }}>
              <ArrowBackIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Box sx={{ flex: 1 }} />
          <Tooltip title="Undo (Ctrl+Z)"><span>
            <IconButton size="small" onClick={onUndo} disabled={!canUndo} sx={{ color: "text.disabled" }}>
              <UndoIcon fontSize="small" />
            </IconButton>
          </span></Tooltip>
          <Tooltip title="Redo (Ctrl+Y)"><span>
            <IconButton size="small" onClick={onRedo} disabled={!canRedo} sx={{ color: "text.disabled" }}>
              <RedoIcon fontSize="small" />
            </IconButton>
          </span></Tooltip>
          <Tooltip title="Export to JSON file">
            <IconButton size="small" onClick={onExport} sx={{ color: "text.disabled" }}>
              <DownloadIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          {/* Status dot — sits right beside the folder icon */}
          <Tooltip title={`Status: ${STATUS_OPTIONS.find((o) => o.value === status)?.label}`}>
            <IconButton size="small" onClick={(e) => setStatusAnchor(e.currentTarget)} sx={{ p: 0.625 }}>
              <Box
                sx={{
                  width: 10, height: 10, borderRadius: "50%",
                  bgcolor: statusColor,
                  boxShadow: `0 0 6px ${statusColor}99`,
                  transition: "box-shadow 0.15s",
                  "button:hover > &": { boxShadow: `0 0 10px ${statusColor}cc` },
                }}
              />
            </IconButton>
          </Tooltip>
          <Menu
            anchorEl={statusAnchor}
            open={!!statusAnchor}
            onClose={() => setStatusAnchor(null)}
            PaperProps={{
              sx: {
                bgcolor: "#161b22", border: "1px solid #21262d",
                boxShadow: "0 8px 32px rgba(0,0,0,0.5)", minWidth: 130,
              },
            }}
          >
            {STATUS_OPTIONS.map((opt) => (
              <MenuItem
                key={opt.value}
                selected={opt.value === status}
                onClick={() => { onStatusChange(opt.value); setStatusAnchor(null); }}
                sx={{ fontSize: "0.8rem", gap: 1.5 }}
              >
                <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: opt.color, flexShrink: 0 }} />
                {opt.label}
              </MenuItem>
            ))}
          </Menu>
          <Tooltip title="Import from JSON file">
            <IconButton size="small" component="label" sx={{ color: "text.disabled" }}>
              <FolderOpenIcon fontSize="small" />
              <input type="file" accept=".json" hidden onChange={onLoad} />
            </IconButton>
          </Tooltip>
        </Stack>

        {/* Name field + save button */}
        <Stack direction="row" spacing={0.5} alignItems="center" mb={1}>
          <TextField
            size="small"
            fullWidth
            placeholder="Mission name…"
            value={missionName}
            onChange={(e) => onNameChange(e.target.value)}
            inputProps={{ maxLength: 60 }}
            sx={{ "& .MuiInputBase-input": { fontSize: "0.85rem" } }}
          />
          <Tooltip title={isDirty ? "Save mission" : "No unsaved changes"}>
            <span>
              <IconButton
                size="small"
                onClick={onSave}
                disabled={isSaving}
                sx={{ color: isDirty ? "primary.main" : "text.disabled" }}
              >
                {isSaving
                  ? <CircularProgress size={16} color="inherit" />
                  : <SaveIcon fontSize="small" />
                }
              </IconButton>
            </span>
          </Tooltip>
        </Stack>

        <TextField
          size="small"
          fullWidth
          label="Notes (optional)"
          value={missionNotes}
          onChange={(e) => onNotesChange(e.target.value)}
          multiline
          minRows={1}
          maxRows={3}
          inputProps={{ maxLength: 300 }}
          placeholder="Operator notes, objectives, conditions…"
        />
      </Paper>

      {/* Terrain */}
      <Paper elevation={0} sx={cardSx(!!uploadResult)}>
        <CardHeader icon={<TerrainIcon sx={{ fontSize: 15 }} />} label="Terrain" />
        <UploadPanel uploadResult={uploadResult} onUploadSuccess={onUploadSuccess} onClear={onUploadClear} elevationErrors={elevationErrors} />
      </Paper>

      {/* Home point */}
      <Paper elevation={0} sx={cardSx(!!start, placeMode === "start")}>
        <CardHeader icon={<PlaceIcon sx={{ fontSize: 15 }} />} label="Home" />
        <StartPointSection
          start={start}
          placeMode={placeMode}
          takeoffMode={takeoffMode}
          takeoffAltM={takeoffAltM}
          onSetPlaceMode={onSetPlaceMode}
          onTakeoffModeChange={onTakeoffModeChange}
          onTakeoffAltChange={onTakeoffAltChange}
        />
      </Paper>

      {/* Waypoints */}
      <Paper elevation={0} sx={cardSx(waypoints.length > 0, placeMode === "waypoint")}>
        <CardHeader icon={<RouteIcon sx={{ fontSize: 15 }} />} label="Waypoints" />
        <Stack spacing={1}>
          {waypoints.length === 0 && (
            <Typography variant="caption" color="text.disabled" sx={{ fontSize: "0.75rem" }}>
              Optional — add stops between start and POIs.
            </Typography>
          )}
          {waypoints.map((wp, i) => (
            <Stack key={i} spacing={0.25}>
              <Stack direction="row" alignItems="center" spacing={0.75}>
                <TextField
                  size="small"
                  placeholder={`WP ${i + 1}`}
                  value={wp.name ?? ""}
                  onChange={(e) => onWaypointNameChange(i, e.target.value)}
                  inputProps={{ maxLength: 30 }}
                  sx={{ flex: 1, "& .MuiInputBase-input": { fontSize: "0.78rem", py: 0.6 } }}
                />
                <IconButton size="small" onClick={() => onRemoveWaypoint(i)} sx={{ p: 0.25, color: "text.disabled", "&:hover": { color: "error.main" } }}>
                  <CloseIcon sx={{ fontSize: 14 }} />
                </IconButton>
              </Stack>
              <Typography variant="caption" color="text.disabled" sx={{ pl: 0.5, fontFamily: "monospace", fontSize: "0.65rem" }}>
                {Math.abs(wp.lat).toFixed(5)}°{wp.lat >= 0 ? "N" : "S"}&nbsp;
                {Math.abs(wp.lon).toFixed(5)}°{wp.lon >= 0 ? "E" : "W"}
              </Typography>
            </Stack>
          ))}
          <Button
            size="small" variant="outlined"
            onClick={() => onSetPlaceMode("waypoint" as InteractionMode)}
            sx={{ textTransform: "none", fontSize: "0.75rem", alignSelf: "flex-start" }}
          >
            + Add waypoint
          </Button>
        </Stack>
      </Paper>

      {/* POIs */}
      <Paper elevation={0} sx={cardSx(pois.length > 0, placeMode === "poi" || interaction.mode === "polygon")}>
        <CardHeader icon={<GpsFixedIcon sx={{ fontSize: 15 }} />} label={pois.length > 0 ? `POIs  (${pois.length})` : "POIs"} />
        <PoiSection
          pois={pois}
          onPoiChange={onPoiChange}
          onPoiRemove={onPoiRemove}
          onPoiActivatePlace={onPoiActivatePlace}
          onActivatePolygonDraw={onActivatePolygonDraw}
          onPoiDragStart={onPoiDragStart}
          onPoiDrop={onPoiDrop}
          onAddPoi={onAddPoi}
        />
      </Paper>

      {/* Live estimates */}
      {liveEstimates && <LiveEstimatesBar estimates={liveEstimates} />}
    </>
  );
}
