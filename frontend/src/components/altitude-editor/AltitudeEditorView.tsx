/**
 * Altitude editor — large Dialog overlay (covers most of the viewport).
 *
 * Layout: 72% Plotly chart | 28% inspector panel, both filling dialog height.
 * The chart uses a fixed pixel height driven by the dialog size so Plotly
 * can render correctly.
 */

import { useEffect, useCallback } from "react";
import { Box, CircularProgress, Dialog, DialogContent, Divider, Typography } from "@mui/material";
import type { PlanMeta } from "../../types/mission";
import { useAltitudeEditor } from "../../hooks/useAltitudeEditor";
import AltitudeChart from "./AltitudeChart";
import InspectorPanel from "./InspectorPanel";

interface AltitudeEditorViewProps {
  open: boolean;
  onClose: () => void;
  sessionId: string | null;
  folder?: string | null;
  minAgl: number;
  maxAgl: number;
  onApplied: (blob: Blob, meta: PlanMeta | null) => void;
}

export default function AltitudeEditorView({
  open,
  onClose,
  sessionId,
  folder,
  minAgl,
  maxAgl,
  onApplied,
}: AltitudeEditorViewProps) {
  const editor = useAltitudeEditor(sessionId, folder ?? null, open, minAgl, maxAgl);

  // Keyboard shortcuts
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        editor.undo();
      } else if (meta && (e.key === "Z" || (e.key === "z" && e.shiftKey))) {
        e.preventDefault();
        editor.redo();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, editor.undo, editor.redo]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = useCallback(async () => {
    const result = await editor.save();
    if (result) {
      onApplied(result.blob, result.meta);
      onClose();
    }
  }, [editor.save, onApplied, onClose]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth={false}
      PaperProps={{
        sx: {
          width: "96vw",
          height: "92vh",
          maxWidth: "none",
          maxHeight: "none",
          bgcolor: "#0d1117",
          border: "1px solid #21262d",
          borderRadius: 2,
          overflow: "hidden",
          display: "flex",
          flexDirection: "row",
        },
      }}
    >
      <DialogContent
        sx={{
          p: 0,
          display: "flex",
          flexDirection: "row",
          flex: 1,
          overflow: "hidden",
        }}
      >
        {editor.loading ? (
          <Box
            sx={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 2,
            }}
          >
            <CircularProgress size={36} sx={{ color: "#388bfd" }} />
            <Typography variant="body2" sx={{ color: "#8b949e" }}>
              Loading altitude data…
            </Typography>
          </Box>
        ) : editor.loadError ? (
          <Box sx={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Typography color="error">{editor.loadError}</Typography>
          </Box>
        ) : editor.editorData ? (
          <>
            {/* Chart — 72% */}
            <Box
              sx={{
                flex: "1 1 0",
                minWidth: 0,
                // Give Plotly a real pixel context via absolute fill of this box
                position: "relative",
              }}
            >
              <Box sx={{ position: "absolute", inset: 0 }}>
                <AltitudeChart
                  wps={editor.editorData.wps}
                  terrain={editor.editorData.terrain}
                  cumDists={editor.editorData.cumDists}
                  alts={editor.alts}
                  aglProfile={editor.aglProfile}
                  minBand={editor.minBand}
                  maxBand={editor.maxBand}
                  validation={editor.validation}
                  profilePoints={editor.editorData.profilePoints}
                  poiBands={editor.editorData.poiBands}
                  bubblePeakTerrain={editor.editorData.bubblePeakTerrain}
                  cameraMinTerrain={editor.editorData.cameraMinTerrain}
                  selectedIdx={editor.selectedIdx}
                  selectedRangeEnd={editor.selectedRangeEnd}
                  onSelectIdx={editor.selectIdx}
                  onSelectRangeEnd={editor.selectRangeEnd}
                />
              </Box>
            </Box>

            <Divider orientation="vertical" sx={{ borderColor: "#21262d" }} />

            {/* Inspector — 300px fixed */}
            <Box sx={{ width: 300, flexShrink: 0 }}>
              <InspectorPanel
                wps={editor.editorData.wps}
                terrain={editor.editorData.terrain}
                cumDists={editor.editorData.cumDists}
                alts={editor.alts}
                aglProfile={editor.aglProfile}
                validation={editor.validation}
                profilePoints={editor.editorData.profilePoints}
                poiBands={editor.editorData.poiBands}
                selectedIdx={editor.selectedIdx}
                selectedRangeEnd={editor.selectedRangeEnd}
                dirty={editor.dirty}
                saving={editor.saving}
                saveError={editor.saveError}
                canUndo={editor.canUndo}
                canRedo={editor.canRedo}
                violations={[]}
                onNudge={editor.nudge}
                onAdjustZone={editor.adjustZone}
                onAdjustRange={editor.adjustRange}
                onSetAlt={editor.setAlt}
                onSetRangeAlt={editor.setRangeAlt}
                onUndo={editor.undo}
                onRedo={editor.redo}
                onReset={editor.reset}
                onSave={handleSave}
                onClose={onClose}
              />
            </Box>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
