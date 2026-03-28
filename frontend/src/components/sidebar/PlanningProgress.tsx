import { useEffect, useRef, useState } from "react";
import { Box, Stack, Typography } from "@mui/material";
import DroneIcon from "../DroneIcon";
import { PLAN_STEPS } from "../../hooks/usePlanRoute";
import type { PlanStep } from "../../hooks/usePlanRoute";

const PHASE_ORDER: PlanStep["phase"][] = ["terrain", "route", "altitude", "safety", "packaging"];

const PHASE_META: Record<PlanStep["phase"], { color: string; icon: string }> = {
  terrain:   { color: "#4fc3f7", icon: "◈" },
  route:     { color: "#81c784", icon: "⬡" },
  altitude:  { color: "#ffb74d", icon: "▲" },
  safety:    { color: "#f06292", icon: "◉" },
  packaging: { color: "#ce93d8", icon: "◎" },
};

interface Props {
  step: number | null; // index into PLAN_STEPS
  /** When true, shows all steps as completed with no live timer. */
  completed?: boolean;
}

export function PlanningProgress({ step, completed = false }: Props) {
  const [elapsed, setElapsed] = useState(0);
  const logRef = useRef<HTMLDivElement>(null);
  const startRef = useRef(Date.now());

  // Only run the elapsed timer when actively planning
  useEffect(() => {
    if (completed) return;
    startRef.current = Date.now();
    setElapsed(0);
    const id = setInterval(() => {
      setElapsed(Math.round((Date.now() - startRef.current) / 100) / 10);
    }, 100);
    return () => clearInterval(id);
  }, [completed]);

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [step]);

  // In completed mode: show all steps done, progress = 100%
  const currentStep = completed ? PLAN_STEPS.length - 1 : (step ?? 0);
  const progress = completed ? 1 : (currentStep + 1) / PLAN_STEPS.length;
  const currentPhase = completed ? "packaging" : (PLAN_STEPS[currentStep]?.phase ?? "terrain");
  const { color: phaseColor, icon: phaseIcon } = completed
    ? { color: "#00e676", icon: "✓" }
    : PHASE_META[currentPhase];

  return (
    <Box
      sx={{
        bgcolor: "#090d12",
        border: "1px solid #1c2128",
        borderRadius: 2,
        overflow: "hidden",
        fontFamily: "monospace",
        position: "relative",
        // subtle scanline texture
        "&::before": {
          content: '""',
          position: "absolute",
          inset: 0,
          backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.012) 2px, rgba(255,255,255,0.012) 4px)",
          pointerEvents: "none",
          zIndex: 0,
        },
      }}
    >
      {/* ── Phase header ── */}
      <Box
        sx={{
          position: "relative",
          zIndex: 1,
          px: 2,
          pt: 1.75,
          pb: 1.5,
          borderBottom: "1px solid #1c2128",
          background: `linear-gradient(90deg, ${phaseColor}14 0%, transparent 100%)`,
          transition: "background 0.5s ease",
        }}
      >
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Stack direction="row" alignItems="center" spacing={1}>
            <Typography
              sx={{
                fontSize: "1.1rem",
                color: phaseColor,
                animation: completed ? "none" : "phasePulse 1.4s ease-in-out infinite",
                "@keyframes phasePulse": {
                  "0%, 100%": { opacity: 1 },
                  "50%": { opacity: 0.55 },
                },
                transition: "color 0.4s",
              }}
            >
              {phaseIcon}
            </Typography>
            <Box>
              <Typography
                sx={{
                  fontSize: "0.62rem",
                  color: "#4a5568",
                  textTransform: "uppercase",
                  letterSpacing: "0.12em",
                  fontFamily: "monospace",
                  lineHeight: 1,
                  mb: 0.25,
                }}
              >
                {completed ? "Completed" : "Active phase"}
              </Typography>
              <Typography
                sx={{
                  fontSize: "0.82rem",
                  fontWeight: 700,
                  color: phaseColor,
                  fontFamily: "monospace",
                  letterSpacing: "0.04em",
                  transition: "color 0.4s",
                }}
              >
                {completed ? "Route ready" : (PLAN_STEPS[currentStep]?.phaseLabel ?? "Initializing")}
              </Typography>
            </Box>
          </Stack>

          {/* Elapsed + step counter */}
          <Stack alignItems="flex-end" spacing={0.25}>
            <Typography sx={{ fontSize: "0.7rem", color: completed ? "#00e676" : "#4a5568", fontFamily: "monospace" }}>
              {completed ? "done" : `${elapsed.toFixed(1)}s`}
            </Typography>
            <Typography sx={{ fontSize: "0.6rem", color: "#2d3748", fontFamily: "monospace" }}>
              {PLAN_STEPS.length} / {PLAN_STEPS.length}
            </Typography>
          </Stack>
        </Stack>
      </Box>

      {/* ── Drone + progress bar ── */}
      <Box sx={{ position: "relative", zIndex: 1, px: 2, pt: 1.5, pb: 1 }}>
        {/* Track */}
        <Box sx={{ position: "relative", height: 6, bgcolor: "#1c2128", borderRadius: 3, overflow: "visible" }}>
          {/* Fill */}
          <Box
            sx={{
              position: "absolute",
              left: 0,
              top: 0,
              height: "100%",
              width: `${progress * 100}%`,
              borderRadius: 3,
              background: `linear-gradient(90deg, ${phaseColor}99, ${phaseColor})`,
              transition: "width 0.6s cubic-bezier(0.4,0,0.2,1)",
              boxShadow: `0 0 10px ${phaseColor}88, 0 0 20px ${phaseColor}44`,
            }}
          />
          {/* Drone icon on the leading edge */}
          <Box
            sx={{
              position: "absolute",
              top: "50%",
              left: `calc(${progress * 100}% - 8px)`,
              transform: "translateY(-50%)",
              transition: "left 0.6s cubic-bezier(0.4,0,0.2,1)",
              filter: `drop-shadow(0 0 4px ${phaseColor})`,
              userSelect: "none",
              lineHeight: 1,
            }}
          >
            <DroneIcon sx={{ fontSize: "0.85rem", color: phaseColor, display: "block" }} />
          </Box>
        </Box>

        {/* Phase dots */}
        <Stack direction="row" justifyContent="space-between" sx={{ mt: 0.75, px: 0.25 }}>
          {PHASE_ORDER.map((ph) => {
            const phaseSteps = PLAN_STEPS.filter((s) => s.phase === ph);
            const firstIdx = PLAN_STEPS.indexOf(phaseSteps[0]);
            const lastIdx = PLAN_STEPS.indexOf(phaseSteps[phaseSteps.length - 1]);
            const done = currentStep > lastIdx;
            const active = currentStep >= firstIdx && currentStep <= lastIdx;
            const meta = PHASE_META[ph];
            return (
              <Typography
                key={ph}
                sx={{
                  fontSize: "0.55rem",
                  fontFamily: "monospace",
                  color: done ? meta.color : active ? meta.color : "#2d3748",
                  opacity: done ? 0.6 : active ? 1 : 0.4,
                  transition: "color 0.3s, opacity 0.3s",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                }}
              >
                {ph}
              </Typography>
            );
          })}
        </Stack>
      </Box>

      {/* ── Log terminal ── */}
      <Box
        ref={logRef}
        sx={{
          position: "relative",
          zIndex: 1,
          px: 2,
          pb: 1.5,
          height: 220,
          overflowY: "auto",
          "&::-webkit-scrollbar": { width: 3 },
          "&::-webkit-scrollbar-track": { bgcolor: "transparent" },
          "&::-webkit-scrollbar-thumb": { bgcolor: "#1c2128", borderRadius: 2 },
        }}
      >
        {PLAN_STEPS.slice(0, currentStep + 1).map((s, i) => {
          const done = completed || i < currentStep;
          const active = !completed && i === currentStep;
          const meta = PHASE_META[s.phase];
          // Timestamp approximation based on STEP_DELAYS
          const STEP_DELAYS_LOCAL = [
            0, 350, 750, 1200, 1800, 2500, 3300,
            4200, 5000, 5700, 6300, 6900, 7500, 8200, 8900,
            9500, 10000, 10500, 11000, 11400, 11800,
          ];
          const ts = (STEP_DELAYS_LOCAL[i] / 1000).toFixed(1);

          return (
            <Stack
              key={i}
              direction="row"
              spacing={1}
              alignItems="baseline"
              sx={{
                py: 0.2,
                animation: "lineIn 0.25s ease-out both",
                "@keyframes lineIn": {
                  from: { opacity: 0, transform: "translateX(-6px)" },
                  to:   { opacity: 1, transform: "translateX(0)" },
                },
              }}
            >
              {/* Timestamp */}
              <Typography
                sx={{
                  fontSize: "0.6rem",
                  color: "#2d3748",
                  fontFamily: "monospace",
                  flexShrink: 0,
                  width: 28,
                  textAlign: "right",
                }}
              >
                {ts}s
              </Typography>

              {/* Status glyph */}
              <Typography
                sx={{
                  fontSize: "0.6rem",
                  color: done ? meta.color : active ? "#ffffff" : "#2d3748",
                  flexShrink: 0,
                  width: 12,
                  textAlign: "center",
                  fontFamily: "monospace",
                  ...(active && {
                    animation: "glyphBlink 0.9s step-end infinite",
                    "@keyframes glyphBlink": {
                      "0%, 100%": { opacity: 1 },
                      "50%": { opacity: 0 },
                    },
                  }),
                }}
              >
                {done ? "✓" : active ? "►" : "·"}
              </Typography>

              {/* Phase badge */}
              <Typography
                sx={{
                  fontSize: "0.55rem",
                  color: meta.color,
                  opacity: done ? 0.45 : active ? 0.8 : 0.3,
                  fontFamily: "monospace",
                  flexShrink: 0,
                  width: 48,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                }}
              >
                [{s.phase.slice(0, 3)}]
              </Typography>

              {/* Message */}
              <Typography
                sx={{
                  fontSize: "0.7rem",
                  color: done ? "#4a5568" : active ? "#e2e8f0" : "#2d3748",
                  fontFamily: "monospace",
                  lineHeight: 1.4,
                  transition: "color 0.2s",
                }}
              >
                {s.msg}
                {active && (
                  <Box
                    component="span"
                    sx={{
                      display: "inline-block",
                      width: "0.5em",
                      height: "0.75em",
                      bgcolor: "#e2e8f0",
                      ml: 0.5,
                      verticalAlign: "text-bottom",
                      animation: "cursorBlink 1s step-end infinite",
                      "@keyframes cursorBlink": {
                        "0%, 100%": { opacity: 1 },
                        "50%": { opacity: 0 },
                      },
                    }}
                  />
                )}
              </Typography>
            </Stack>
          );
        })}
      </Box>
    </Box>
  );
}
