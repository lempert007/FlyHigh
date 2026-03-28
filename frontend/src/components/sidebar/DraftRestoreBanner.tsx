import { Alert, Box, Button, Stack, Typography } from "@mui/material";
import HistoryIcon from "@mui/icons-material/History";

interface DraftRestoreBannerProps {
  draftAge: string;
  onRestore: () => void;
  onDismiss: () => void;
}

/** Banner shown on mount when a saved draft is found in localStorage. */
export function DraftRestoreBanner({ draftAge, onRestore, onDismiss }: DraftRestoreBannerProps) {
  return (
    <Alert
      severity="info"
      icon={<HistoryIcon sx={{ fontSize: "1rem" }} />}
      sx={{ py: 0.5, fontSize: "0.78rem", "& .MuiAlert-message": { width: "100%" } }}
    >
      <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
        <Typography variant="caption" sx={{ color: "inherit" }}>
          Unsaved mission from <strong>{draftAge}</strong>
        </Typography>
        <Box sx={{ display: "flex", gap: 0.5, flexShrink: 0 }}>
          <Button
            size="small"
            variant="contained"
            color="info"
            onClick={onRestore}
            sx={{ textTransform: "none", py: 0.25, px: 1, fontSize: "0.72rem", minWidth: 0 }}
          >
            Restore
          </Button>
          <Button
            size="small"
            color="inherit"
            onClick={onDismiss}
            sx={{ textTransform: "none", py: 0.25, px: 0.75, fontSize: "0.72rem", minWidth: 0, opacity: 0.7 }}
          >
            Dismiss
          </Button>
        </Box>
      </Stack>
    </Alert>
  );
}
