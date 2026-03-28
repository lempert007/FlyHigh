import { Box, Button, ButtonGroup, Paper, Stack, Tooltip, Typography } from "@mui/material";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import PauseIcon from "@mui/icons-material/Pause";
import ReplayIcon from "@mui/icons-material/Replay";
import DroneIcon from "../DroneIcon";
import { Chip } from "@mui/material";
import type { FlightPreviewState, PreviewSpeed } from "../../hooks/useFlightPreview";
import { formatTime, formatDist } from "../../utils/math";

interface FlightPreviewPanelProps {
  flightPreview: FlightPreviewState;
  totalDistanceM: number;
}

const SPEEDS: PreviewSpeed[] = [1, 5, 20];

export function FlightPreviewPanel({ flightPreview, totalDistanceM }: FlightPreviewPanelProps) {
  const {
    isActive,
    isPlaying,
    progress,
    speedMultiplier,
    totalDurationSec,
    elapsedSec,
    activate,
    deactivate,
    play,
    pause,
    reset,
    setSpeed,
    seek,
  } = flightPreview;

  return (
    <Paper
      elevation={0}
      data-tutorial="flight-preview"
      sx={{
        border: "1px solid #1c2128",
        borderRadius: 2,
        overflow: "hidden",
        bgcolor: "#090d12",
        "&::before": {
          content: '""',
          position: "absolute",
          inset: 0,
          backgroundImage:
            "repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(255,255,255,0.01) 2px,rgba(255,255,255,0.01) 4px)",
          pointerEvents: "none",
        },
        position: "relative",
      }}
    >
      {/* Header */}
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{
          px: 2,
          pt: 1.5,
          pb: 1,
          borderBottom: "1px solid #1c2128",
          background: "linear-gradient(90deg,rgba(0,229,255,0.07) 0%,transparent 100%)",
        }}
      >
        <Stack direction="row" alignItems="center" spacing={1}>
          <DroneIcon
            sx={{
              fontSize: "1rem",
              color: "#00E5FF",
              animation: isActive && isPlaying ? "previewPulse 2s ease-in-out infinite" : "none",
              "@keyframes previewPulse": { "0%,100%": { opacity: 1 }, "50%": { opacity: 0.5 } },
            }}
          />
          <Box>
            <Typography
              sx={{
                fontSize: "0.6rem",
                color: "#4a5568",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                fontFamily: "monospace",
                lineHeight: 1,
                mb: 0.25,
              }}
            >
              Flight Preview
            </Typography>
            <Typography
              sx={{
                fontSize: "0.72rem",
                color: isActive ? "#00E5FF" : "#4a5568",
                fontFamily: "monospace",
                fontWeight: 600,
                transition: "color 0.3s",
              }}
            >
              {!isActive
                ? "Ready"
                : isPlaying
                  ? `${speedMultiplier}× speed`
                  : progress >= 1
                    ? "Complete"
                    : "Paused"}
            </Typography>
          </Box>
        </Stack>
        {isActive && (
          <Tooltip title="Exit preview">
            <Chip
              label="Exit"
              size="small"
              onClick={deactivate}
              sx={{
                fontSize: "0.62rem",
                height: 20,
                cursor: "pointer",
                borderColor: "#30363d",
                color: "text.disabled",
              }}
              variant="outlined"
            />
          </Tooltip>
        )}
      </Stack>

      <Box sx={{ px: 2, py: 1.5 }}>
        {!isActive ? (
          <Button
            variant="outlined"
            fullWidth
            size="small"
            startIcon={<DroneIcon />}
            onClick={() => {
              activate();
              play();
            }}
            sx={{
              textTransform: "none",
              fontWeight: 600,
              borderColor: "#00E5FF",
              color: "#00E5FF",
              "&:hover": { borderColor: "#00E5FF", bgcolor: "rgba(0,229,255,0.07)" },
              boxShadow: "0 0 12px rgba(0,229,255,0.15)",
            }}
          >
            Simulate Flight
          </Button>
        ) : (
          <Stack spacing={1.5}>
            {/* Progress track with drone — click or drag to seek */}
            <Box>
              <Box
                onClick={(e) => {
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  seek((e.clientX - rect.left) / rect.width);
                }}
                onMouseDown={(e) => {
                  const el = e.currentTarget as HTMLElement;
                  const doSeek = (ev: MouseEvent) => {
                    const rect = el.getBoundingClientRect();
                    seek(Math.min(Math.max((ev.clientX - rect.left) / rect.width, 0), 1));
                  };
                  doSeek(e.nativeEvent);
                  const up = () => {
                    window.removeEventListener("mousemove", doSeek);
                    window.removeEventListener("mouseup", up);
                  };
                  window.addEventListener("mousemove", doSeek);
                  window.addEventListener("mouseup", up);
                }}
                sx={{
                  position: "relative",
                  height: 10,
                  bgcolor: "#1c2128",
                  borderRadius: 3,
                  cursor: "pointer",
                  "&:hover": { bgcolor: "#232b35" },
                }}
              >
                {/* Unflown */}
                <Box sx={{ position: "absolute", inset: 0, borderRadius: 3, bgcolor: "#1e2d3d" }} />
                {/* Flown */}
                <Box
                  sx={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    height: "100%",
                    width: `${progress * 100}%`,
                    borderRadius: 3,
                    background: "linear-gradient(90deg, rgba(0,229,255,0.6), #00E5FF)",
                    boxShadow: "0 0 6px #00E5FF66",
                    transition: "width 0.1s linear",
                    pointerEvents: "none",
                  }}
                />
                {/* Drone */}
                <Box
                  sx={{
                    position: "absolute",
                    top: "50%",
                    left: `clamp(8px, calc(${progress * 100}% - 8px), calc(100% - 8px))`,
                    transform: "translateY(-50%)",
                    lineHeight: 1,
                    filter: "drop-shadow(0 0 3px #00E5FF)",
                    transition: "left 0.1s linear",
                    userSelect: "none",
                    pointerEvents: "none",
                  }}
                >
                  <DroneIcon sx={{ fontSize: "0.9rem", color: "#00E5FF", display: "block" }} />
                </Box>
              </Box>
              {/* Time labels */}
              <Stack direction="row" justifyContent="space-between" sx={{ mt: 0.5 }}>
                <Typography sx={{ fontSize: "0.6rem", color: "#4a5568", fontFamily: "monospace" }}>
                  0:00
                </Typography>
                <Typography sx={{ fontSize: "0.6rem", color: "#4a5568", fontFamily: "monospace" }}>
                  {formatTime(totalDurationSec)}
                </Typography>
              </Stack>
            </Box>

            {/* Stats row */}
            <Stack
              direction="row"
              spacing={0}
              sx={{
                bgcolor: "#0d1117",
                border: "1px solid #1c2128",
                borderRadius: 1,
                overflow: "hidden",
              }}
            >
              {[
                { label: "Elapsed", value: formatTime(elapsedSec), color: "#00E5FF" },
                {
                  label: "Remaining",
                  value: formatTime(Math.max(0, totalDurationSec - elapsedSec)),
                  color: "#4a5568",
                },
                {
                  label: "Distance",
                  value: formatDist(progress * totalDistanceM),
                  color: "#FF7043",
                },
                { label: "Complete", value: `${Math.round(progress * 100)}%`, color: "#00E5FF" },
              ].map((stat, i) => (
                <Box
                  key={i}
                  sx={{
                    flex: 1,
                    px: 1,
                    py: 0.75,
                    borderRight: i < 3 ? "1px solid #1c2128" : "none",
                    textAlign: "center",
                  }}
                >
                  <Typography
                    sx={{
                      fontSize: "0.55rem",
                      color: "#2d3748",
                      fontFamily: "monospace",
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      display: "block",
                      mb: 0.25,
                    }}
                  >
                    {stat.label}
                  </Typography>
                  <Typography
                    sx={{
                      fontSize: "0.72rem",
                      color: stat.color,
                      fontFamily: "monospace",
                      fontWeight: 700,
                    }}
                  >
                    {stat.value}
                  </Typography>
                </Box>
              ))}
            </Stack>

            {/* Controls */}
            <Stack direction="row" alignItems="center" spacing={1}>
              {isPlaying ? (
                <Button
                  size="small"
                  variant="outlined"
                  onClick={pause}
                  sx={{
                    minWidth: 36,
                    px: 0.75,
                    borderColor: "#00E5FF",
                    color: "#00E5FF",
                    "&:hover": { bgcolor: "rgba(0,229,255,0.08)" },
                  }}
                >
                  <PauseIcon fontSize="small" />
                </Button>
              ) : (
                <Button
                  size="small"
                  variant="contained"
                  onClick={play}
                  disabled={progress >= 1}
                  sx={{
                    minWidth: 36,
                    px: 0.75,
                    bgcolor: "#00E5FF",
                    color: "#000",
                    "&:hover": { bgcolor: "#33eaff" },
                    boxShadow: "0 0 10px rgba(0,229,255,0.4)",
                  }}
                >
                  <PlayArrowIcon fontSize="small" />
                </Button>
              )}
              <Button
                size="small"
                variant="outlined"
                onClick={reset}
                sx={{ minWidth: 36, px: 0.75 }}
              >
                <ReplayIcon fontSize="small" />
              </Button>
              <ButtonGroup
                size="small"
                sx={{
                  ml: "auto",
                  "& .MuiButton-root": {
                    fontSize: "0.65rem",
                    fontWeight: 700,
                    px: 0.9,
                    fontFamily: "monospace",
                  },
                }}
              >
                {SPEEDS.map((s) => (
                  <Button
                    key={s}
                    onClick={() => setSpeed(s)}
                    variant={speedMultiplier === s ? "contained" : "outlined"}
                    sx={{
                      ...(speedMultiplier === s && {
                        bgcolor: "#00E5FF",
                        color: "#000",
                        borderColor: "#00E5FF",
                        "&:hover": { bgcolor: "#33eaff" },
                      }),
                    }}
                  >
                    {s}×
                  </Button>
                ))}
              </ButtonGroup>
            </Stack>
          </Stack>
        )}
      </Box>
    </Paper>
  );
}
