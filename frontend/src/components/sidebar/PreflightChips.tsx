import { Chip, Stack } from "@mui/material";
import TerrainIcon from "@mui/icons-material/Terrain";

interface PreflightChipsProps {
  hasUpload: boolean;
  hasStart: boolean;
  poiCount: number;
  hasPlan: boolean;
}

/** Status chips showing upload, start, POI, and plan readiness. */
export function PreflightChips({ hasUpload, hasStart, poiCount, hasPlan }: PreflightChipsProps) {
  return (
    <Stack direction="row" flexWrap="wrap" gap={0.5} sx={{ px: 0.5 }}>
      <Chip
        size="small"
        icon={<TerrainIcon sx={{ fontSize: "0.85rem !important" }} />}
        label={hasUpload ? "Terrain ✓" : "No terrain"}
        color={hasUpload ? "success" : "default"}
        variant={hasUpload ? "filled" : "outlined"}
        sx={{ fontSize: "0.7rem" }}
      />
      <Chip
        size="small"
        label={hasStart ? "Start ✓" : "No start"}
        color={hasStart ? "success" : "default"}
        variant={hasStart ? "filled" : "outlined"}
        sx={{ fontSize: "0.7rem" }}
      />
      <Chip
        size="small"
        label={poiCount > 0 ? `${poiCount} POI${poiCount > 1 ? "s" : ""} ✓` : "No POIs"}
        color={poiCount > 0 ? "success" : "default"}
        variant={poiCount > 0 ? "filled" : "outlined"}
        sx={{ fontSize: "0.7rem" }}
      />
      <Chip
        size="small"
        label="Plan & Download"
        color={hasPlan ? "success" : "default"}
        variant={hasPlan ? "filled" : "outlined"}
        sx={{ fontSize: "0.7rem" }}
      />
    </Stack>
  );
}
