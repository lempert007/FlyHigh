/**
 * Inspector panel for the altitude editor.
 *
 * Interaction model:
 *  - Click a point on the chart → shows its segment type, current AGL, step buttons
 *  - +1 / +5 / -1 / -5 buttons nudge the selected waypoint up/down
 *  - "Adjust whole zone" section lets user raise/lower an entire POI scan block
 *  - Undo / Redo / Reset / Apply in the footer
 */

import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import UndoIcon from "@mui/icons-material/Undo";
import RedoIcon from "@mui/icons-material/Redo";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import SaveIcon from "@mui/icons-material/Save";
import CloseIcon from "@mui/icons-material/Close";
import KeyboardArrowUpIcon from "@mui/icons-material/KeyboardArrowUp";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import KeyboardDoubleArrowUpIcon from "@mui/icons-material/KeyboardDoubleArrowUp";
import KeyboardDoubleArrowDownIcon from "@mui/icons-material/KeyboardDoubleArrowDown";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";

import type { ProfilePoint, Violation } from "../../types/mission";
import type { WpPoint, ValidationStatus } from "../../utils/altitudeEditorUtils";
import { formatDist } from "../../utils/math";

interface InspectorPanelProps {
  wps: WpPoint[];
  cumDists: number[];
  alts: number[];
  aglProfile: number[];
  validation: ValidationStatus[];
  profilePoints: ProfilePoint[];
  selectedIdx: number | null;
  dirty: boolean;
  saving: boolean;
  saveError: string | null;
  canUndo: boolean;
  canRedo: boolean;
  violations: Violation[];
  selectedRangeEnd: number | null;
  onNudge: (idx: number, delta: number) => void;
  onAdjustZone: (poiId: number, delta: number) => void;
  onAdjustRange: (fromIdx: number, toIdx: number, delta: number) => void;
  onSetAlt: (idx: number, alt_m: number) => void;
  onSetRangeAlt: (fromIdx: number, toIdx: number, alt_m: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  onReset: () => void;
  onSave: () => void;
  onClose: () => void;
}

const SEGMENT_LABELS: Record<string, string> = {
  transit: "Transit",
  poi_scan: "POI Scan",
  waypoint: "Waypoint",
};

const SEGMENT_COLORS: Record<string, string> = {
  transit: "#484f58",
  poi_scan: "#b8860b",
  waypoint: "#388bfd",
};

function NudgeRow({
  label,
  onUp,
  onDown,
  bigStep,
  smallStep,
}: {
  label: string;
  onUp: (delta: number) => void;
  onDown: (delta: number) => void;
  bigStep: number;
  smallStep: number;
}) {
  return (
    <Box>
      <Typography variant="caption" sx={{ color: "#8b949e", display: "block", mb: 0.75 }}>
        {label}
      </Typography>
      <Stack direction="row" spacing={0.5}>
        <Tooltip title={`+${bigStep} m`}>
          <Button
            size="small"
            variant="outlined"
            onClick={() => onUp(bigStep)}
            sx={nudgeBtnSx}
            startIcon={<KeyboardDoubleArrowUpIcon sx={{ fontSize: "1rem !important" }} />}
          >
            {bigStep} m
          </Button>
        </Tooltip>
        <Tooltip title={`+${smallStep} m`}>
          <Button
            size="small"
            variant="outlined"
            onClick={() => onUp(smallStep)}
            sx={nudgeBtnSx}
            startIcon={<KeyboardArrowUpIcon sx={{ fontSize: "1rem !important" }} />}
          >
            {smallStep} m
          </Button>
        </Tooltip>
        <Tooltip title={`-${smallStep} m`}>
          <Button
            size="small"
            variant="outlined"
            onClick={() => onDown(smallStep)}
            sx={nudgeBtnSx}
            startIcon={<KeyboardArrowDownIcon sx={{ fontSize: "1rem !important" }} />}
          >
            {smallStep} m
          </Button>
        </Tooltip>
        <Tooltip title={`-${bigStep} m`}>
          <Button
            size="small"
            variant="outlined"
            onClick={() => onDown(bigStep)}
            sx={nudgeBtnSx}
            startIcon={<KeyboardDoubleArrowDownIcon sx={{ fontSize: "1rem !important" }} />}
          >
            {bigStep} m
          </Button>
        </Tooltip>
      </Stack>
    </Box>
  );
}

const nudgeBtnSx = {
  textTransform: "none",
  fontSize: "0.72rem",
  px: 0.75,
  py: 0.5,
  minWidth: 0,
  borderColor: "#30363d",
  color: "#c9d1d9",
  "&:hover": { borderColor: "#484f58", bgcolor: "rgba(255,255,255,0.05)" },
};

export default function InspectorPanel({
  wps,
  cumDists,
  alts,
  aglProfile,
  validation,
  profilePoints,
  selectedIdx,
  selectedRangeEnd,
  dirty,
  saving,
  saveError,
  canUndo,
  canRedo,
  violations,
  onNudge,
  onAdjustZone,
  onAdjustRange,
  onSetAlt,
  onSetRangeAlt,
  onUndo,
  onRedo,
  onReset,
  onSave,
  onClose,
}: InspectorPanelProps) {
  const [absoluteAltInput, setAbsoluteAltInput] = useState("");

  const selectedWp = selectedIdx !== null ? wps[selectedIdx] : null;
  const selectedPp = selectedIdx !== null ? profilePoints[selectedIdx] : null;
  const selectedAlt = selectedIdx !== null ? alts[selectedIdx] : null;
  const selectedAgl = selectedIdx !== null ? aglProfile[selectedIdx] : null;
  const selectedValidation = selectedIdx !== null ? validation[selectedIdx] : null;

  // Find the POI id for the selected point (for zone-level adjust)
  const selectedPoiId = selectedPp?.poi_id ?? null;

  const violationCount = violations.length;
  const hardCount = violations.filter((v) => v.category === "safety").length;

  // Sync absolute alt input when selection changes
  useEffect(() => {
    if (selectedAlt !== null) {
      setAbsoluteAltInput(selectedAlt.toFixed(1));
    } else {
      setAbsoluteAltInput("");
    }
  }, [selectedIdx, selectedAlt]);

  const handleApplyAbsoluteAlt = useCallback(() => {
    if (selectedIdx === null) return;
    const v = parseFloat(absoluteAltInput);
    if (isNaN(v) || v <= 0) return;
    if (selectedRangeEnd !== null) {
      onSetRangeAlt(selectedIdx, selectedRangeEnd, v);
    } else {
      onSetAlt(selectedIdx, v);
    }
  }, [selectedIdx, selectedRangeEnd, absoluteAltInput, onSetAlt, onSetRangeAlt]);

  const handleNudge = useCallback(
    (delta: number) => {
      if (selectedIdx === null) return;
      onNudge(selectedIdx, delta);
    },
    [selectedIdx, onNudge]
  );

  const handleZoneAdjust = useCallback(
    (delta: number) => {
      if (selectedPoiId === null) return;
      onAdjustZone(selectedPoiId, delta);
    },
    [selectedPoiId, onAdjustZone]
  );

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        bgcolor: "#0d1117",
        borderLeft: "1px solid #21262d",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          px: 2,
          py: 1.25,
          borderBottom: "1px solid #21262d",
          flexShrink: 0,
        }}
      >
        <Typography
          variant="subtitle2"
          sx={{ color: "#c9d1d9", fontWeight: 600, fontSize: "0.9rem" }}
        >
          Altitude Editor
        </Typography>
        <IconButton size="small" onClick={onClose} sx={{ color: "#8b949e" }}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>

      <Box sx={{ flex: 1, overflowY: "auto", px: 2, py: 1.5 }}>
        {/* ── No selection ── */}
        {!selectedWp && (
          <Box
            sx={{
              border: "1px dashed #30363d",
              borderRadius: 1,
              p: 2,
              textAlign: "center",
              mb: 2,
            }}
          >
            <Typography variant="body2" sx={{ color: "#8b949e", fontSize: "0.8rem" }}>
              Click any point on the chart to select it, then use the buttons below to adjust its
              altitude.
            </Typography>
          </Box>
        )}

        {/* ── Selected point info ── */}
        {selectedWp && selectedPp && (
          <Box sx={{ mb: 2 }}>
            {/* Segment badge + status */}
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
              <Chip
                label={SEGMENT_LABELS[selectedPp.segment_type] ?? selectedPp.segment_type}
                size="small"
                sx={{
                  bgcolor: SEGMENT_COLORS[selectedPp.segment_type] ?? "#484f58",
                  color: "#fff",
                  fontSize: "0.7rem",
                  height: 22,
                  fontWeight: 600,
                }}
              />
              {selectedPp.poi_id !== null && (
                <Chip
                  label={`POI ${selectedPp.poi_id + 1}`}
                  size="small"
                  sx={{ bgcolor: "#21262d", color: "#c9d1d9", fontSize: "0.7rem", height: 22 }}
                />
              )}
              {selectedValidation === "below" && (
                <Tooltip title="Below min AGL">
                  <WarningAmberIcon sx={{ color: "#ff5252", fontSize: 17, ml: "auto" }} />
                </Tooltip>
              )}
              {selectedValidation === "above" && (
                <Tooltip title="Above max AGL">
                  <WarningAmberIcon sx={{ color: "#ff9100", fontSize: 17, ml: "auto" }} />
                </Tooltip>
              )}
              {selectedValidation === "ok" && (
                <CheckCircleIcon sx={{ color: "#00e676", fontSize: 17, ml: "auto" }} />
              )}
            </Stack>

            {/* Stats row */}
            <Stack
              direction="row"
              divider={<Divider orientation="vertical" flexItem sx={{ borderColor: "#21262d" }} />}
              spacing={1.5}
              sx={{
                bgcolor: "#161b22",
                border: "1px solid #21262d",
                borderRadius: 1,
                px: 1.5,
                py: 1,
                mb: 1.5,
              }}
            >
              <Box>
                <Typography
                  variant="caption"
                  sx={{ color: "#8b949e", fontSize: "0.68rem", display: "block" }}
                >
                  Distance
                </Typography>
                <Typography
                  variant="caption"
                  sx={{ color: "#c9d1d9", fontSize: "0.8rem", fontWeight: 600 }}
                >
                  {formatDist(cumDists[selectedIdx!])}
                </Typography>
              </Box>
              <Box>
                <Typography
                  variant="caption"
                  sx={{ color: "#8b949e", fontSize: "0.68rem", display: "block" }}
                >
                  AGL
                </Typography>
                <Typography
                  variant="caption"
                  sx={{
                    color:
                      selectedValidation === "below"
                        ? "#ff5252"
                        : selectedValidation === "above"
                          ? "#ff9100"
                          : "#00e676",
                    fontSize: "0.8rem",
                    fontWeight: 600,
                  }}
                >
                  {selectedAgl?.toFixed(1)} m
                </Typography>
              </Box>
              <Box>
                <Typography
                  variant="caption"
                  sx={{ color: "#8b949e", fontSize: "0.68rem", display: "block" }}
                >
                  Alt MSL
                </Typography>
                <Typography
                  variant="caption"
                  sx={{ color: "#c9d1d9", fontSize: "0.8rem", fontWeight: 600 }}
                >
                  {selectedAlt?.toFixed(1)} m
                </Typography>
              </Box>
            </Stack>

            {/* ── Nudge this point ── */}
            <NudgeRow
              label="Adjust this point"
              onUp={(d) => handleNudge(d)}
              onDown={(d) => handleNudge(-d)}
              bigStep={5}
              smallStep={1}
            />

            {/* ── Set absolute MSL altitude ── */}
            <Box sx={{ mt: 1.25 }}>
              <Typography variant="caption" sx={{ color: "#8b949e", display: "block", mb: 0.75 }}>
                Set absolute MSL altitude
              </Typography>
              <Stack direction="row" spacing={0.75} alignItems="center">
                <TextField
                  size="small"
                  type="number"
                  value={absoluteAltInput}
                  onChange={(e) => setAbsoluteAltInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleApplyAbsoluteAlt();
                  }}
                  inputProps={{
                    step: 1,
                    style: { color: "#c9d1d9", fontSize: "0.8rem", padding: "4px 8px" },
                  }}
                  sx={{
                    width: 90,
                    "& fieldset": { borderColor: "#30363d" },
                    "&:hover fieldset": { borderColor: "#484f58" },
                    "& .MuiInputBase-root": { bgcolor: "#161b22" },
                  }}
                />
                <Typography variant="caption" sx={{ color: "#8b949e" }}>
                  m MSL
                </Typography>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={handleApplyAbsoluteAlt}
                  sx={{ ...nudgeBtnSx, px: 1.25 }}
                >
                  Set
                </Button>
              </Stack>
            </Box>

            {/* ── Range adjust (when shift-click range is active) ── */}
            {selectedRangeEnd !== null && selectedIdx !== null && (
              <>
                <Divider sx={{ borderColor: "#21262d", my: 1.5 }} />
                <NudgeRow
                  label={`Adjust selected range (#${Math.min(selectedIdx, selectedRangeEnd)}–#${Math.max(selectedIdx, selectedRangeEnd)}) — Shift+click to extend`}
                  onUp={(d) => onAdjustRange(selectedIdx!, selectedRangeEnd, d)}
                  onDown={(d) => onAdjustRange(selectedIdx!, selectedRangeEnd, -d)}
                  bigStep={5}
                  smallStep={1}
                />
              </>
            )}
            {selectedRangeEnd === null && (
              <Typography
                variant="caption"
                sx={{ color: "#484f58", fontSize: "0.68rem", display: "block", mt: 0.75 }}
              >
                Shift+click another point to select a range
              </Typography>
            )}
          </Box>
        )}

        {/* ── Adjust entire POI zone ── */}
        {selectedPoiId !== null && (
          <>
            <Divider sx={{ borderColor: "#21262d", my: 1.5 }} />
            <NudgeRow
              label={`Raise / lower entire POI ${selectedPoiId + 1} scan`}
              onUp={(d) => handleZoneAdjust(d)}
              onDown={(d) => handleZoneAdjust(-d)}
              bigStep={5}
              smallStep={1}
            />
          </>
        )}

        {/* ── Violations ── */}
        {violationCount > 0 && (
          <>
            <Divider sx={{ borderColor: "#21262d", my: 1.5 }} />
            <Typography
              variant="caption"
              sx={{
                color: "#8b949e",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                display: "block",
                mb: 0.5,
              }}
            >
              Violations after last save
            </Typography>
            <Stack spacing={0.5}>
              {hardCount > 0 && (
                <Alert
                  severity="error"
                  icon={false}
                  sx={{
                    py: 0.25,
                    px: 1,
                    fontSize: "0.72rem",
                    bgcolor: "rgba(239,83,80,0.1)",
                    color: "#ef5350",
                  }}
                >
                  {hardCount} safety violation{hardCount > 1 ? "s" : ""}
                </Alert>
              )}
              {violationCount - hardCount > 0 && (
                <Alert
                  severity="warning"
                  icon={false}
                  sx={{
                    py: 0.25,
                    px: 1,
                    fontSize: "0.72rem",
                    bgcolor: "rgba(255,145,0,0.1)",
                    color: "#ff9100",
                  }}
                >
                  {violationCount - hardCount} product violation
                  {violationCount - hardCount > 1 ? "s" : ""}
                </Alert>
              )}
            </Stack>
          </>
        )}
      </Box>

      {/* ── Footer actions ── */}
      <Box
        sx={{
          px: 2,
          py: 1.25,
          borderTop: "1px solid #21262d",
          flexShrink: 0,
          bgcolor: "#0d1117",
        }}
      >
        {saveError && (
          <Alert severity="error" sx={{ mb: 1, py: 0.25, fontSize: "0.72rem" }}>
            {saveError}
          </Alert>
        )}

        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
          <Tooltip title="Undo (⌘Z)">
            <span>
              <IconButton
                size="small"
                onClick={onUndo}
                disabled={!canUndo}
                sx={{ color: canUndo ? "#8b949e" : "#30363d" }}
              >
                <UndoIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="Redo (⌘⇧Z)">
            <span>
              <IconButton
                size="small"
                onClick={onRedo}
                disabled={!canRedo}
                sx={{ color: canRedo ? "#8b949e" : "#30363d" }}
              >
                <RedoIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="Reset all changes">
            <span>
              <IconButton
                size="small"
                onClick={onReset}
                disabled={!dirty}
                sx={{ color: dirty ? "#8b949e" : "#30363d" }}
              >
                <RestartAltIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Box sx={{ flex: 1 }} />
          {dirty && (
            <Typography variant="caption" sx={{ color: "#8b949e", fontSize: "0.68rem" }}>
              Unsaved changes
            </Typography>
          )}
        </Stack>

        <Button
          fullWidth
          variant="contained"
          size="small"
          startIcon={saving ? <CircularProgress size={13} color="inherit" /> : <SaveIcon />}
          onClick={onSave}
          disabled={saving || !dirty}
          sx={{
            textTransform: "none",
            fontWeight: 600,
            bgcolor: "#238636",
            "&:hover": { bgcolor: "#2ea043" },
            "&.Mui-disabled": { bgcolor: "#161b22", color: "#484f58" },
          }}
        >
          {saving ? "Applying…" : "Apply & Close"}
        </Button>
      </Box>
    </Box>
  );
}
