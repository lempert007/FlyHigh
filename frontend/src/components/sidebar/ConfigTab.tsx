import { useState } from "react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from "@mui/material";
import type { FlightConfig } from "../../types/mission";
import type { DronePreset } from "../../dronePresets";
import FlightConfigPanel from "../FlightConfigPanel";

interface ConfigTabProps {
  config: FlightConfig;
  onChange: (cfg: FlightConfig) => void;
  isValid: boolean;
  presets?: DronePreset[];
  availableTerrainTypes?: ("DSM" | "DTM")[];
}

/** Config tab — wraps FlightConfigPanel with a one-time expert-lock dialog. */
export function ConfigTab({
  config,
  onChange,
  isValid,
  presets,
  availableTerrainTypes,
}: ConfigTabProps) {
  const [expertAcknowledged, setExpertAcknowledged] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  function handleFieldFocus() {
    if (!expertAcknowledged) setDialogOpen(true);
  }

  function handleConfirm() {
    setExpertAcknowledged(true);
    setDialogOpen(false);
  }

  return (
    <>
      <FlightConfigPanel
        config={config}
        onChange={onChange}
        stepDone={isValid}
        presets={presets}
        onFieldFocus={expertAcknowledged ? undefined : handleFieldFocus}
        availableTerrainTypes={availableTerrainTypes}
      />

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontSize: "1rem", fontWeight: 700 }}>Expert territory</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            These fields control low-level flight parameters. Incorrect values can affect safety and
            mission success.
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Use the drone presets above for safe defaults. Only proceed if you know what you're
            changing.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ justifyContent: "center", pb: 2 }}>
          <Button onClick={handleConfirm} variant="contained" size="small" color="warning">
            I understand, proceed
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
