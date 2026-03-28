import React from "react";
import { Button, Paper, Stack, TextField } from "@mui/material";

interface MissionIdentityBarProps {
  missionName: string;
  onNameChange: (v: string) => void;
  onSave: () => void;
  onLoad: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

/** Mission name field + Save/Load route buttons. */
export function MissionIdentityBar({
  missionName,
  onNameChange,
  onSave,
  onLoad,
}: MissionIdentityBarProps) {
  return (
    <Paper elevation={2} sx={{ p: 1.5 }}>
      <Stack direction="row" spacing={1} alignItems="center">
        <TextField
          size="small"
          fullWidth
          placeholder="Mission name…"
          value={missionName}
          onChange={(e) => onNameChange(e.target.value)}
          inputProps={{ maxLength: 60 }}
          sx={{ "& .MuiInputBase-input": { fontSize: "0.85rem" } }}
        />
        <Button
          size="small"
          variant="outlined"
          onClick={onSave}
          sx={{ textTransform: "none", whiteSpace: "nowrap", flexShrink: 0 }}
        >
          Save
        </Button>
        <Button
          size="small"
          variant="outlined"
          component="label"
          sx={{ textTransform: "none", whiteSpace: "nowrap", flexShrink: 0 }}
        >
          Load
          <input type="file" accept=".json" hidden onChange={onLoad} />
        </Button>
      </Stack>
    </Paper>
  );
}
