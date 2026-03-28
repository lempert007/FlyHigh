import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  IconButton,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableRow,
  Tooltip,
  Typography,
} from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import ClearIcon from "@mui/icons-material/Clear";
import { fetchAvailableTiffs, activateTiffs } from "../api";
import type { AvailableTiff, TiffSelection, UploadResult } from "../types/mission";

interface UploadPanelProps {
  onUploadSuccess: (result: UploadResult) => void;
  onClear: () => void;
  elevationErrors: Record<string, string>;
  uploadResult: UploadResult | null;
}

const typeColor: Record<string, "warning" | "success"> = { DSM: "warning", DTM: "success" };

export default function UploadPanel({
  onUploadSuccess,
  onClear,
  elevationErrors,
  uploadResult,
}: UploadPanelProps) {
  const [available, setAvailable] = useState<AvailableTiff[]>([]);
  const [fetchLoading, setFetchLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Per-file: checked state + user-override type
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [types, setTypes] = useState<Record<string, "DSM" | "DTM">>({});

  const [activating, setActivating] = useState(false);
  const [activateError, setActivateError] = useState<string | null>(null);

  const loadLibrary = useCallback(async () => {
    setFetchLoading(true);
    setFetchError(null);
    try {
      const tiffs = await fetchAvailableTiffs();
      setAvailable(tiffs);
      // Initialise types from inferred_type; unknown → DSM
      setTypes(
        Object.fromEntries(tiffs.map((t) => [t.name, t.inferred_type === "DTM" ? "DTM" : "DSM"]))
      );
      setChecked({});
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : String(err));
    } finally {
      setFetchLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!uploadResult) loadLibrary();
  }, [uploadResult, loadLibrary]);

  const toggleCheck = useCallback((name: string) => {
    setChecked((prev) => ({ ...prev, [name]: !prev[name] }));
  }, []);

  const setType = useCallback((name: string, type: "DSM" | "DTM") => {
    setTypes((prev) => ({ ...prev, [name]: type }));
  }, []);

  const handleActivate = useCallback(async () => {
    const selections: TiffSelection[] = available
      .filter((t) => checked[t.name])
      .map((t) => ({ name: t.name, type: types[t.name] ?? "DSM" }));
    if (!selections.length) return;
    setActivateError(null);
    setActivating(true);
    try {
      const result = await activateTiffs(selections);
      onUploadSuccess(result);
    } catch (err) {
      setActivateError(err instanceof Error ? err.message : String(err));
    } finally {
      setActivating(false);
    }
  }, [available, checked, types, onUploadSuccess]);

  const handleClear = useCallback(() => {
    setChecked({});
    setActivateError(null);
    onClear();
  }, [onClear]);

  const selectedCount = Object.values(checked).filter(Boolean).length;

  return (
    <Paper elevation={2} sx={{ p: 2 }} data-tutorial="upload">
      <Typography variant="subtitle1" fontWeight={600} gutterBottom>
        1. Select Terrain Files
      </Typography>

      {/* ── Library browser (pre-activation) ── */}
      {!uploadResult && (
        <>
          {fetchLoading && <LinearProgress sx={{ my: 1, borderRadius: 1 }} />}

          {fetchError && (
            <Alert
              severity="error"
              sx={{ mb: 1 }}
              action={
                <IconButton size="small" onClick={loadLibrary}>
                  <RefreshIcon fontSize="small" />
                </IconButton>
              }
            >
              {fetchError}
            </Alert>
          )}

          {!fetchLoading && !fetchError && available.length === 0 && (
            <Alert severity="info" sx={{ mb: 1 }}>
              No terrain files found in the library.
            </Alert>
          )}

          {!fetchLoading && available.length > 0 && (
            <Stack spacing={1}>
              <Typography variant="caption" color="text.secondary">
                Select one or more files and set the type, then load.
              </Typography>

              <Box
                sx={{
                  maxHeight: 280,
                  overflowY: "auto",
                  border: "1px solid",
                  borderColor: "divider",
                  borderRadius: 1,
                }}
              >
                {available.map((tiff) => (
                  <Stack
                    key={tiff.name}
                    direction="row"
                    alignItems="center"
                    spacing={1}
                    sx={{
                      px: 1,
                      py: 0.5,
                      cursor: "pointer",
                      bgcolor: checked[tiff.name] ? "action.selected" : "transparent",
                      "&:hover": { bgcolor: "action.hover" },
                      borderBottom: "1px solid",
                      borderColor: "divider",
                      "&:last-child": { borderBottom: "none" },
                    }}
                    onClick={() => toggleCheck(tiff.name)}
                  >
                    <Checkbox
                      checked={!!checked[tiff.name]}
                      size="small"
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => toggleCheck(tiff.name)}
                      sx={{ p: 0.5 }}
                    />
                    <Typography variant="body2" noWrap sx={{ flex: 1, fontSize: "0.8rem" }}>
                      {tiff.name}
                    </Typography>
                    <Select
                      size="small"
                      value={types[tiff.name] ?? "DSM"}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setType(tiff.name, e.target.value as "DSM" | "DTM")}
                      sx={{ minWidth: 72, fontSize: "0.75rem" }}
                    >
                      <MenuItem value="DSM">DSM</MenuItem>
                      <MenuItem value="DTM">DTM</MenuItem>
                    </Select>
                  </Stack>
                ))}
              </Box>

              {activateError && (
                <Alert severity="error" onClose={() => setActivateError(null)}>
                  {activateError}
                </Alert>
              )}

              <Stack direction="row" spacing={1} alignItems="center">
                <Button
                  size="small"
                  variant="contained"
                  onClick={handleActivate}
                  disabled={activating || selectedCount === 0}
                  startIcon={
                    activating ? <CircularProgress size={14} color="inherit" /> : undefined
                  }
                >
                  {activating
                    ? "Loading…"
                    : `Load Terrain${selectedCount > 0 ? ` (${selectedCount})` : ""}`}
                </Button>
                <Tooltip title="Refresh file list">
                  <span>
                    <IconButton size="small" onClick={loadLibrary} disabled={fetchLoading}>
                      <RefreshIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
              </Stack>
            </Stack>
          )}
        </>
      )}

      {/* ── Loaded state ── */}
      {uploadResult && (
        <Stack spacing={1} mt={1}>
          {Object.entries(elevationErrors).map(([name, msg]) => (
            <Alert key={name} severity="warning" sx={{ py: 0 }}>
              Terrain preview unavailable for <strong>{name}</strong>: {msg}
            </Alert>
          ))}
          {uploadResult.files.map((f) => (
            <Paper key={f.name} variant="outlined" sx={{ p: 1 }}>
              <Stack direction="row" alignItems="center" spacing={1} mb={0.5}>
                <Chip
                  label={f.inferred_type}
                  size="small"
                  color={typeColor[f.inferred_type] ?? "default"}
                />
                <Typography variant="body2" fontWeight={600} noWrap sx={{ flex: 1 }}>
                  {f.name}
                </Typography>
              </Stack>
              <Table size="small" padding="none">
                <TableBody>
                  <TableRow>
                    <TableCell sx={{ color: "text.secondary", pr: 1 }}>Resolution</TableCell>
                    <TableCell>{f.resolution_m.toFixed(1)} m/px</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell sx={{ color: "text.secondary", pr: 1 }}>Bounds (W,S,E,N)</TableCell>
                    <TableCell sx={{ fontFamily: "monospace", fontSize: "0.7rem" }}>
                      {f.bbox.map((v) => v.toFixed(4)).join(", ")}
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell sx={{ color: "text.secondary", pr: 1 }}>CRS</TableCell>
                    <TableCell sx={{ fontFamily: "monospace", fontSize: "0.7rem" }}>
                      {f.crs}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </Paper>
          ))}
          <Tooltip title="Clear terrain and re-select">
            <IconButton size="small" onClick={handleClear} sx={{ alignSelf: "flex-start" }}>
              <ClearIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
      )}
    </Paper>
  );
}
