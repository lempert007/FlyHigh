import { Alert, Box, Button, Tooltip } from "@mui/material";
import DroneIcon from "../DroneIcon";
import { PlanningProgress } from "./PlanningProgress";

interface PlanButtonProps {
  canPlan: boolean;
  isPlanning: boolean;
  planningStep: number | null;
  planError: string | null;
  sessionId: string | null;
  hasStart: boolean;
  hasPois: boolean;
  onPlan: () => void;
  onClearError: () => void;
}

export function PlanButton({ canPlan, isPlanning, planningStep, planError, sessionId, hasStart, hasPois, onPlan, onClearError }: PlanButtonProps) {
  const tooltip = !sessionId
    ? "Upload terrain files first"
    : !hasStart
    ? "Set a home point on the map"
    : !hasPois
    ? "Add at least one POI"
    : "";

  return (
    <>
      {!isPlanning && (
        <Tooltip title={tooltip}>
          <Box component="span">
            <Button
              variant="contained"
              size="large"
              fullWidth
              disabled={!canPlan}
              onClick={onPlan}
              startIcon={<DroneIcon />}
              sx={{
                ...(canPlan && {
                  animation: "planReady 2s ease-in-out infinite",
                  "@keyframes planReady": {
                    "0%, 100%": { boxShadow: "0 0 0 0 rgba(30,144,255,0.4)" },
                    "50%":       { boxShadow: "0 0 0 8px rgba(30,144,255,0)" },
                  },
                }),
              }}
            >
              Plan Route
            </Button>
          </Box>
        </Tooltip>
      )}

      {isPlanning && <PlanningProgress step={planningStep} />}

      {planError && (
        <Alert severity="error" onClose={onClearError} sx={{ mt: 1 }}>
          {planError}
        </Alert>
      )}
    </>
  );
}
