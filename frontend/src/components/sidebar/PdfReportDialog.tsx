import { useState } from "react";
import {
  Button, CircularProgress, Dialog, DialogActions,
  DialogContent, DialogTitle, Stack, TextField, Typography,
} from "@mui/material";
import PictureAsPdfIcon from "@mui/icons-material/PictureAsPdf";
import { downloadPdfReport, downloadBlob } from "../../api";

interface PdfReportDialogProps {
  open: boolean;
  onClose: () => void;
  sessionId: string;
  missionName?: string;
}

export default function PdfReportDialog({
  open, onClose, sessionId, missionName,
}: PdfReportDialogProps) {
  const [operatorName, setOperatorName] = useState("");
  const [organization, setOrganization] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    setLoading(true);
    setError(null);
    try {
      const blob = await downloadPdfReport(sessionId, operatorName, organization);
      const filename = `flyhigh_report_${missionName ? missionName.replace(/\s+/g, "_").slice(0, 30) : "mission"}.pdf`;
      downloadBlob(blob, filename);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onClose={loading ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <PictureAsPdfIcon sx={{ color: "#ef5350" }} />
        Generate PDF Report
      </DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Creates a professional mission report for manager review.
        </Typography>
        <Stack spacing={2}>
          <TextField
            label="Operator / Pilot Name"
            size="small"
            fullWidth
            value={operatorName}
            onChange={(e) => setOperatorName(e.target.value)}
            disabled={loading}
            autoFocus
          />
          <TextField
            label="Organization"
            size="small"
            fullWidth
            placeholder="Optional"
            value={organization}
            onChange={(e) => setOrganization(e.target.value)}
            disabled={loading}
          />
          {error && (
            <Typography variant="caption" color="error">
              {error}
            </Typography>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={loading} size="small">
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleGenerate}
          disabled={loading}
          startIcon={loading ? <CircularProgress size={14} color="inherit" /> : <PictureAsPdfIcon />}
          size="small"
          sx={{ minWidth: 130 }}
        >
          {loading ? "Generating…" : "Generate PDF"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
