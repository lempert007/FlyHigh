import { Box, Stack, Typography } from "@mui/material";

interface StepHeaderProps {
  n: number | string;
  label: string;
  done: boolean;
  mb?: number;
}

/** Numbered step completion indicator used in the sidebar. */
export function StepHeader({ n, label, done, mb = 1 }: StepHeaderProps) {
  return (
    <Stack direction="row" alignItems="center" spacing={1} mb={mb}>
      <Box sx={{
        width: 22, height: 22, borderRadius: "50%",
        display: "flex", alignItems: "center", justifyContent: "center",
        bgcolor: done ? "success.main" : "primary.main",
        fontSize: "0.65rem", fontWeight: 700, color: "white",
        boxShadow: done ? "0 0 8px rgba(76,175,80,0.6)" : "0 0 8px rgba(30,144,255,0.4)",
        transition: "all 0.3s", flexShrink: 0,
      }}>
        {done ? "✓" : n}
      </Box>
      <Typography variant="subtitle2" fontWeight={600}>{label}</Typography>
    </Stack>
  );
}
