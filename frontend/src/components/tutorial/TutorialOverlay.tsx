import { useEffect, useRef, useState } from "react";
import { Box, Button, Chip, Paper, Portal, Stack, Typography } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import type { TutorialStep } from "./tutorialSteps";

const PAD = 8;
const CARD_WIDTH = 360;

interface Props {
  step: TutorialStep;
  stepIndex: number;
  total: number;
  activeTab: number;
  setActiveTab: (tab: number) => void;
  onNext: () => void;
  onBack: () => void;
  onStop: () => void;
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
}

function computeCardPosition(rect: Rect | null): { top: number; left: number } {
  if (!rect) {
    return {
      top: window.innerHeight / 2 - 120,
      left: window.innerWidth / 2 - CARD_WIDTH / 2,
    };
  }

  // Prefer right side
  if (rect.right + CARD_WIDTH + 24 <= window.innerWidth) {
    return {
      top: Math.min(rect.top, window.innerHeight - 260),
      left: rect.right + 16,
    };
  }
  // Prefer left side
  if (rect.left - CARD_WIDTH - 16 >= 0) {
    return {
      top: Math.min(rect.top, window.innerHeight - 260),
      left: rect.left - CARD_WIDTH - 16,
    };
  }
  // Below
  if (rect.bottom + 220 <= window.innerHeight) {
    return {
      top: rect.bottom + 12,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - CARD_WIDTH - 8)),
    };
  }
  // Above
  return {
    top: Math.max(8, rect.top - 220),
    left: Math.max(8, Math.min(rect.left, window.innerWidth - CARD_WIDTH - 8)),
  };
}

export function TutorialOverlay({
  step,
  stepIndex,
  total,
  activeTab,
  setActiveTab,
  onNext,
  onBack,
  onStop,
}: Props) {
  const [rect, setRect] = useState<Rect | null>(null);
  const rafRef = useRef<number | null>(null);

  // Esc to stop
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onStop();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onStop]);

  // Switch tab + measure target on step change
  useEffect(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);

    function measure() {
      if (!step.target) {
        setRect(null);
        return;
      }
      const el = document.querySelector(`[data-tutorial="${step.target}"]`);
      if (!el) {
        setRect(null);
        return;
      }
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
      // Wait one more frame after scroll to get stable rect
      rafRef.current = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        setRect({
          top: r.top,
          left: r.left,
          width: r.width,
          height: r.height,
          right: r.right,
          bottom: r.bottom,
        });
      });
    }

    if (step.tab !== activeTab) {
      setActiveTab(step.tab);
      // Wait two frames: one for React re-render, one for layout
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = requestAnimationFrame(measure);
      });
    } else {
      rafRef.current = requestAnimationFrame(measure);
    }

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIndex]);

  const cardPos = computeCardPosition(rect);
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === total - 1;

  return (
    <Portal>
      {/* SVG backdrop with mask hole over target */}
      <svg
        style={{
          position: "fixed",
          inset: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
          zIndex: 9998,
        }}
      >
        <defs>
          <mask id="tut-mask">
            <rect fill="white" width="100%" height="100%" />
            {rect && (
              <rect
                fill="black"
                x={rect.left - PAD}
                y={rect.top - PAD}
                width={rect.width + PAD * 2}
                height={rect.height + PAD * 2}
                rx={6}
              />
            )}
          </mask>
        </defs>
        <rect fill="rgba(0,0,0,0.72)" width="100%" height="100%" mask="url(#tut-mask)" />
      </svg>

      {/* Glowing highlight border over target */}
      {rect && (
        <Box
          sx={{
            position: "fixed",
            top: rect.top - PAD,
            left: rect.left - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
            borderRadius: 1,
            pointerEvents: "none",
            zIndex: 9998,
            boxShadow: "0 0 0 2px #1E90FF, 0 0 28px 6px rgba(30,144,255,0.45)",
            animation: "tutGlow 1.5s ease-in-out infinite alternate",
          }}
        />
      )}

      {/* Popover card */}
      <Paper
        elevation={8}
        sx={{
          position: "fixed",
          top: cardPos.top,
          left: cardPos.left,
          width: CARD_WIDTH,
          zIndex: 9999,
          p: 2.5,
          bgcolor: "background.paper",
          border: "1px solid rgba(30,144,255,0.3)",
          borderRadius: 2,
        }}
      >
        <Stack direction="row" alignItems="center" justifyContent="space-between" mb={1.5}>
          <Chip
            label={`Step ${stepIndex + 1} of ${total}`}
            size="small"
            sx={{
              bgcolor: "rgba(30,144,255,0.12)",
              color: "#1E90FF",
              fontWeight: 600,
              fontSize: "0.7rem",
            }}
          />
          <Button
            size="small"
            onClick={onStop}
            sx={{
              minWidth: 0,
              p: 0.5,
              color: "text.disabled",
              "&:hover": { color: "text.primary" },
            }}
          >
            <CloseIcon fontSize="small" />
          </Button>
        </Stack>

        <Typography variant="h6" fontWeight={700} sx={{ mb: 1, fontSize: "1rem", lineHeight: 1.3 }}>
          {step.title}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5, lineHeight: 1.6 }}>
          {step.body}
        </Typography>

        <Stack direction="row" spacing={1} justifyContent="flex-end">
          {!isFirst && (
            <Button
              size="small"
              onClick={onBack}
              variant="outlined"
              sx={{ textTransform: "none", minWidth: 72 }}
            >
              ← Back
            </Button>
          )}
          <Button
            size="small"
            onClick={onNext}
            variant="contained"
            sx={{
              textTransform: "none",
              minWidth: 80,
              bgcolor: "#1E90FF",
              "&:hover": { bgcolor: "#1a7fe0" },
            }}
          >
            {isLast ? "Finish ✓" : "Next →"}
          </Button>
        </Stack>
      </Paper>
    </Portal>
  );
}
