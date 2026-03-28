import { Box, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import type { InteractionMode, LatLon } from "../../types/mission";

interface StartPointSectionProps {
  start: LatLon | null;
  placeMode: string;
  takeoffMode: "auto" | "fixed";
  takeoffAltM: number;
  onSetPlaceMode: (mode: InteractionMode) => void;
  onTakeoffModeChange: (mode: "auto" | "fixed") => void;
  onTakeoffAltChange: (v: number) => void;
}

/** Start point indicator + takeoff altitude mode. */
export function StartPointSection({
  start,
  placeMode,
  takeoffMode,
  takeoffAltM,
  onSetPlaceMode,
  onTakeoffModeChange,
  onTakeoffAltChange,
}: StartPointSectionProps) {
  return (
    <Stack spacing={1} data-tutorial="home">
      <Box
        sx={{
          p: 1,
          border: "1px solid",
          borderColor: start ? "success.dark" : "divider",
          borderRadius: 1,
          cursor: "pointer",
          bgcolor: placeMode === "start" ? "action.selected" : "transparent",
          "&:hover": { borderColor: "success.main" },
        }}
        onClick={() => onSetPlaceMode("start" as InteractionMode)}
      >
        <Typography variant="body2" color={start ? "success.main" : "text.secondary"}>
          {start
            ? `Home: ${start.lat.toFixed(4)}, ${start.lon.toFixed(4)}`
            : "Click to set home point on map"}
        </Typography>
      </Box>

      {start && (
        <Stack direction="row" spacing={1} alignItems="center">
          <ToggleButtonGroup
            size="small"
            value={takeoffMode}
            exclusive
            onChange={(_, v) => {
              if (v) onTakeoffModeChange(v);
            }}
            sx={{
              "& .MuiToggleButton-root": {
                textTransform: "none",
                fontSize: "0.7rem",
                py: 0.25,
                px: 1,
              },
            }}
          >
            <ToggleButton value="auto">Auto (terrain)</ToggleButton>
            <ToggleButton value="fixed">Fixed MSL</ToggleButton>
          </ToggleButtonGroup>
          {takeoffMode === "fixed" && (
            <TextField
              size="small"
              label="Alt (m MSL)"
              type="number"
              value={takeoffAltM}
              onChange={(e) => onTakeoffAltChange(parseFloat(e.target.value) || 0)}
              inputProps={{ step: 10, min: 1 }}
              sx={{ width: 110 }}
            />
          )}
        </Stack>
      )}
    </Stack>
  );
}
