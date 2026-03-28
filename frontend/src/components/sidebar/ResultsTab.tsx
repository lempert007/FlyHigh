import { Box, Button, Collapse, Divider, Stack, Tooltip, Typography } from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import HistoryIcon from "@mui/icons-material/History";
import PictureAsPdfIcon from "@mui/icons-material/PictureAsPdf";
import { useState, useEffect } from "react";
import PdfReportDialog from "./PdfReportDialog";
import type { PlanMeta } from "../../types/mission";
import type { FlightPreviewState } from "../../hooks/useFlightPreview";
import ResultsPanel from "../ResultsPanel";
import { PlanButton } from "./PlanButton";
import { PlanningProgress } from "./PlanningProgress";
import { FlightPreviewPanel } from "./FlightPreviewPanel";

interface ResultsTabProps {
  meta: PlanMeta | null;
  zipBlob: Blob | null;
  flightPreview: FlightPreviewState;
  // Planning
  canPlan: boolean;
  isConfigValid: boolean;
  isPlanning: boolean;
  planningStep: number | null;
  planError: string | null;
  sessionId: string | null;
  folder?: string | null;
  missionName?: string;
  hasStart: boolean;
  hasPois: boolean;
  onPlan: () => void;
  onClearPlanError: () => void;
  onViolationClick?: (lat: number, lon: number) => void;
  onAltitudesApplied?: (blob: Blob, meta: PlanMeta | null) => void;
  batteryWarningPct?: number;
  batteryErrorPct?: number;
  violationFilters?: { safety: boolean; product_poi: boolean; product_route: boolean };
  onToggleViolationCategory?: (cat: "safety" | "product_poi" | "product_route") => void;
}

/** Results tab: plan button (pre-plan) or KPI panel + flight preview (post-plan). */
export function ResultsTab({
  meta,
  zipBlob,
  flightPreview,
  canPlan,
  isConfigValid,
  isPlanning,
  planningStep,
  planError,
  sessionId,
  folder,
  missionName,
  hasStart,
  hasPois,
  onPlan,
  onClearPlanError,
  onViolationClick,
  onAltitudesApplied,
  batteryWarningPct,
  batteryErrorPct,
  violationFilters,
  onToggleViolationCategory,
}: ResultsTabProps) {
  const [showPlanDetails, setShowPlanDetails] = useState(false);
  const [pdfDialogOpen, setPdfDialogOpen] = useState(false);

  // Auto-hide plan details when a new plan starts
  useEffect(() => {
    if (isPlanning) setShowPlanDetails(false);
  }, [isPlanning]);

  // Pre-plan state: show the Plan button
  if (!meta || !zipBlob) {
    return (
      <Box
        sx={{ display: "flex", flexDirection: "column", flex: 1, gap: 2, pt: 1 }}
        data-tutorial="plan-button"
      >
        {!isConfigValid && (
          <Typography
            variant="caption"
            color="warning.main"
            textAlign="center"
            sx={{ fontSize: "0.75rem" }}
          >
            ⚠ Flight config has errors — check the Config tab.
          </Typography>
        )}
        <PlanButton
          canPlan={canPlan && isConfigValid}
          isPlanning={isPlanning}
          planningStep={planningStep}
          planError={planError}
          sessionId={sessionId}
          hasStart={hasStart}
          hasPois={hasPois}
          onPlan={onPlan}
          onClearError={onClearPlanError}
        />
      </Box>
    );
  }

  // Re-planning in progress (have existing results but running again)
  if (isPlanning) {
    return (
      <Box sx={{ display: "flex", flexDirection: "column", flex: 1, gap: 2, pt: 1 }}>
        <PlanningProgress step={planningStep} />
      </Box>
    );
  }

  return (
    <>
      {/* Re-plan + details toggle */}
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Tooltip title={showPlanDetails ? "Hide planning log" : "Show planning log"}>
          <Button
            size="small"
            variant={showPlanDetails ? "contained" : "outlined"}
            startIcon={<HistoryIcon />}
            onClick={() => setShowPlanDetails((v) => !v)}
            sx={{
              textTransform: "none",
              fontSize: "0.72rem",
              ...(showPlanDetails
                ? {
                    bgcolor: "#1c2128",
                    color: "#00e676",
                    borderColor: "#00e676",
                    "&:hover": { bgcolor: "#22302a" },
                  }
                : {
                    borderColor: "#30363d",
                    color: "text.secondary",
                    "&:hover": { borderColor: "#484f58" },
                  }),
            }}
          >
            Plan log
          </Button>
        </Tooltip>
        <Tooltip title="Run planning again with current settings">
          <Button
            size="small"
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={onPlan}
            disabled={isPlanning}
            sx={{
              textTransform: "none",
              fontSize: "0.72rem",
              borderColor: "#30363d",
              color: "text.secondary",
              "&:hover": { borderColor: "#484f58" },
            }}
          >
            Re-plan
          </Button>
        </Tooltip>
      </Stack>

      <Collapse in={showPlanDetails} unmountOnExit>
        <PlanningProgress step={null} completed />
      </Collapse>

      <Box data-tutorial="results-panel">
        <ResultsPanel
          meta={meta}
          zipBlob={zipBlob}
          sessionId={sessionId}
          folder={folder}
          onViolationClick={onViolationClick}
          onAltitudesApplied={onAltitudesApplied}
          batteryWarningPct={batteryWarningPct}
          batteryErrorPct={batteryErrorPct}
          violationFilters={violationFilters}
          onToggleViolationCategory={onToggleViolationCategory}
        />
      </Box>

      <Tooltip
        title={
          !sessionId
            ? "Upload terrain data to enable PDF generation"
            : "Generate a professional PDF mission report"
        }
      >
        <span>
          <Button
            fullWidth
            size="small"
            variant="outlined"
            startIcon={<PictureAsPdfIcon />}
            onClick={() => setPdfDialogOpen(true)}
            disabled={!sessionId}
            sx={{
              textTransform: "none",
              borderColor: "#ef5350",
              color: "#ef5350",
              "&:hover": { borderColor: "#ff5252", bgcolor: "rgba(239,83,80,0.08)" },
              "&.Mui-disabled": { borderColor: "#30363d", color: "#555" },
            }}
          >
            Generate PDF Report
          </Button>
        </span>
      </Tooltip>

      {sessionId && (
        <PdfReportDialog
          open={pdfDialogOpen}
          onClose={() => setPdfDialogOpen(false)}
          sessionId={sessionId}
          missionName={missionName}
        />
      )}

      <Divider />

      <FlightPreviewPanel
        flightPreview={flightPreview}
        totalDistanceM={meta.total_distance_m ?? 0}
      />
    </>
  );
}
