import { Box, Stack, Tooltip, Typography } from "@mui/material";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import { formatDist, formatTime } from "../../utils/math";
import type { LiveEstimates } from "../../hooks/useLiveEstimates";

interface LiveEstimatesBarProps {
  estimates: LiveEstimates;
}

/** Compact pre-plan rough estimate bar shown below the points list. */
export function LiveEstimatesBar({ estimates }: LiveEstimatesBarProps) {
  const { totalEstDistanceM, estFlightTimeSec } = estimates;

  return (
    <Box
      sx={{
        p: 1,
        bgcolor: "rgba(30,144,255,0.06)",
        border: "1px solid rgba(30,144,255,0.18)",
        borderRadius: 1,
      }}
    >
      <Stack direction="row" alignItems="center" spacing={0.5} mb={0.5}>
        <Typography
          variant="caption"
          color="text.disabled"
          sx={{
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            fontSize: "0.6rem",
          }}
        >
          Quick Estimate
        </Typography>
        <Tooltip title="Rough straight-line estimate before planning. Does not account for terrain, altitude changes, or actual coverage paths.">
          <InfoOutlinedIcon sx={{ fontSize: 11, color: "text.disabled", cursor: "help" }} />
        </Tooltip>
      </Stack>
      <Stack direction="row" spacing={2.5}>
        <Box>
          <Typography
            variant="caption"
            color="text.disabled"
            display="block"
            sx={{ fontSize: "0.6rem" }}
          >
            Distance
          </Typography>
          <Typography
            variant="caption"
            fontFamily="monospace"
            fontWeight={600}
            sx={{ color: "#1E90FF" }}
          >
            {formatDist(totalEstDistanceM)}
          </Typography>
        </Box>
        <Box>
          <Typography
            variant="caption"
            color="text.disabled"
            display="block"
            sx={{ fontSize: "0.6rem" }}
          >
            Flight time
          </Typography>
          <Typography variant="caption" fontFamily="monospace" fontWeight={600}>
            ~{formatTime(estFlightTimeSec)}
          </Typography>
        </Box>
      </Stack>
    </Box>
  );
}
