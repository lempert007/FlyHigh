/**
 * Full-screen interactive altitude profile editor.
 *
 * Interaction model:
 *  - Drag segment bars (between handles) up/down to shift both endpoints together.
 *  - Drag individual handle circles for fine-tuning a single point.
 *  - Click a segment bar (no drag) to insert a new handle at that point.
 *  - Double-click an inserted handle to remove it.
 *  - POI blocks are shown as tinted rectangles with a single handle.
 *  - Live AGL-band validation colours segments red/amber without a backend call.
 *  - "Apply to Mission" posts to the backend and updates the results tab.
 */

import { useState, useCallback, useMemo } from "react";
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import UndoIcon from "@mui/icons-material/Undo";
import SaveIcon from "@mui/icons-material/Save";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";

import { useAltitudeEditor } from "../hooks/useAltitudeEditor";
import { applyAltitudeEdit, applyFolderAltitudeEdit } from "../api";
import type { AltNode } from "../utils/altitudeEditorUtils";
import type { PlanMeta } from "../types/mission";
import {
  AltitudeChart,
  makeScales,
  clientToSvg,
  PT,
  CHART_H,
  PL,
  CHART_W,
} from "./altitude-editor/AltitudeChart";
import type { DragState, SegmentBar } from "./altitude-editor/AltitudeChart";

// ── Main modal ────────────────────────────────────────────────────────────────

interface AltitudeEditorModalProps {
  open: boolean;
  onClose: () => void;
  sessionId: string | null;
  folder?: string | null;
  minAgl: number;
  maxAgl: number;
  /** Called when the user applies edits; parent updates its state. */
  onApplied: (blob: Blob, meta: PlanMeta | null) => void;
}

export default function AltitudeEditorModal({
  open,
  onClose,
  sessionId,
  folder,
  minAgl,
  maxAgl,
  onApplied,
}: AltitudeEditorModalProps) {
  const {
    loading,
    loadError,
    editorData,
    nodes,
    reconAlt,
    validation,
    minBand,
    maxBand,
    isDirty,
    dragNode,
    dragTwoNodes,
    insertNode,
    removeNode,
    reset,
  } = useAltitudeEditor(sessionId, folder ?? null, open, minAgl, maxAgl);

  const [dragState, setDragState] = useState<DragState | null>(null);
  const [hoveredSegmentKey, setHoveredSegmentKey] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  // ── Derived stats ──────────────────────────────────────────────────────────
  const belowCount = validation.filter((v) => v === "below").length;
  const aboveCount = validation.filter((v) => v === "above").length;
  const minClearance = editorData
    ? Math.min(...reconAlt.map((a, i) => a - editorData.terrain[i]))
    : null;

  // ── SVG scale helpers (stable: uses origAlts, not reconAlt) ───────────────
  const svgScales = useMemo(() => {
    if (!editorData || editorData.wps.length === 0) return null;
    const totalDist = editorData.cumDists[editorData.cumDists.length - 1] || 1;
    const origAlts = editorData.wps.map((w) => w.alt_m);
    return { ...makeScales(totalDist, origAlts, editorData.terrain, maxAgl), totalDist };
  }, [editorData, maxAgl]);

  // ── Handle drag ────────────────────────────────────────────────────────────
  const handleHandlePointerDown = useCallback(
    (e: React.PointerEvent<SVGCircleElement>, nodeId: string) => {
      if (!svgScales) return;
      (e.currentTarget as SVGCircleElement).setPointerCapture(e.pointerId);
      setDragState({
        type: "handle",
        id: nodeId,
        altMin: svgScales.altMin,
        altRange: svgScales.altRange,
      });
    },
    [svgScales]
  );

  // ── Segment drag ───────────────────────────────────────────────────────────
  const handleSegmentPointerDown = useCallback(
    (e: React.PointerEvent<SVGLineElement>, seg: SegmentBar) => {
      if (!svgScales) return;

      const nodeA = nodes.find((n) => n.id === seg.idA);
      const nodeB = nodes.find((n) => n.id === seg.idB);
      if (!nodeA || !nodeB) return;

      const svgEl = (e.currentTarget as SVGElement).closest("svg") as SVGSVGElement;
      const { y: startSvgY } = clientToSvg(e.clientX, e.clientY, svgEl);

      (e.currentTarget as SVGLineElement).setPointerCapture(e.pointerId);
      setDragState({
        type: "segment",
        idA: seg.idA,
        idB: seg.idB,
        initialAltA: nodeA.alt_m,
        initialAltB: nodeB.alt_m,
        startSvgY,
        hasMoved: false,
        distA: seg.distA,
        distB: seg.distB,
        totalDist: svgScales.totalDist,
        altMin: svgScales.altMin,
        altRange: svgScales.altRange,
        isDraggable: seg.isDraggable,
      });
    },
    [svgScales, nodes]
  );

  // ── Pointer move (handles both drag types) ─────────────────────────────────
  const handlePointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (!dragState || !editorData) return;
      const svgEl = e.currentTarget;
      const { y } = clientToSvg(e.clientX, e.clientY, svgEl);

      if (dragState.type === "handle") {
        const newAlt = dragState.altMin + ((PT + CHART_H - y) / CHART_H) * dragState.altRange;
        dragNode(dragState.id, newAlt);
      } else if (dragState.isDraggable) {
        const deltaAlt = -((y - dragState.startSvgY) / CHART_H) * dragState.altRange;
        if (!dragState.hasMoved && Math.abs(y - dragState.startSvgY) > 5) {
          setDragState((prev) => (prev ? { ...prev, hasMoved: true } : prev));
        }
        dragTwoNodes(
          dragState.idA,
          dragState.initialAltA + deltaAlt,
          dragState.idB,
          dragState.initialAltB + deltaAlt
        );
      }
    },
    [dragState, editorData, dragNode, dragTwoNodes]
  );

  // ── Pointer up (handle release or segment click/release) ───────────────────
  const handlePointerUp = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (dragState?.type === "segment" && !dragState.hasMoved) {
        // Short click on a segment → insert a handle at the click X, clamped to the segment span
        const { x } = clientToSvg(e.clientX, e.clientY, e.currentTarget);
        const rawDist = ((x - PL) / CHART_W) * dragState.totalDist;
        const dist = Math.max(dragState.distA, Math.min(dragState.distB, rawDist));
        insertNode(dist);
      }
      setDragState(null);
    },
    [dragState, insertNode]
  );

  // ── Double-click removes inserted nodes ───────────────────────────────────
  const handleNodeDblClick = useCallback(
    (id: string, type: AltNode["type"]) => {
      if (type === "inserted") removeNode(id);
    },
    [removeNode]
  );

  // ── Apply & re-plan safety ─────────────────────────────────────────────────
  const handleApply = async () => {
    setApplying(true);
    setApplyError(null);
    try {
      const { blob, meta } = sessionId
        ? await applyAltitudeEdit(sessionId, reconAlt)
        : await applyFolderAltitudeEdit(folder!, reconAlt);
      onApplied(blob, meta);
      onClose();
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : String(err));
    } finally {
      setApplying(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="xl"
      fullWidth
      PaperProps={{ sx: { bgcolor: "#0d1117", border: "1px solid #30363d", borderRadius: 2 } }}
    >
      <DialogTitle
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          pb: 1,
          borderBottom: "1px solid #21262d",
        }}
      >
        <Box sx={{ flex: 1 }}>
          <Typography variant="subtitle1" fontWeight={700} color="text.primary">
            Manual Altitude Editor
          </Typography>
          <Typography variant="caption" color="text.disabled">
            Drag a segment bar to shift both ends · drag a handle for fine control · click a segment
            to add a point · double-click an added point to remove it
          </Typography>
        </Box>
        <Tooltip title="Reset to algorithm output">
          <span>
            <Button
              size="small"
              variant="outlined"
              startIcon={<UndoIcon />}
              onClick={reset}
              disabled={!isDirty || loading}
              sx={{
                textTransform: "none",
                fontSize: "0.72rem",
                mr: 1,
                borderColor: "#30363d",
                color: "text.secondary",
              }}
            >
              Reset
            </Button>
          </span>
        </Tooltip>
        <IconButton onClick={onClose} size="small" sx={{ color: "text.disabled" }}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{ p: 2, display: "flex", flexDirection: "column", gap: 1.5 }}>
        {/* Chart area */}
        <Box
          sx={{
            bgcolor: "#161b22",
            border: "1px solid #21262d",
            borderRadius: 1,
            p: 1,
            minHeight: 420,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {loading && <CircularProgress size={32} />}
          {loadError && (
            <Typography color="error" variant="body2">
              {loadError}
            </Typography>
          )}
          {!loading && !loadError && editorData && (
            <AltitudeChart
              origAlts={editorData.wps.map((w) => w.alt_m)}
              terrain={editorData.terrain}
              cumDists={editorData.cumDists}
              reconAlt={reconAlt}
              validation={validation}
              nodes={nodes}
              minBand={minBand}
              maxBand={maxBand}
              maxAgl={maxAgl}
              dragState={dragState}
              hoveredSegmentKey={hoveredSegmentKey}
              hoveredNodeId={hoveredNodeId}
              onHandlePointerDown={handleHandlePointerDown}
              onSegmentPointerDown={handleSegmentPointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onNodeDblClick={handleNodeDblClick}
              onSegmentHover={setHoveredSegmentKey}
              onHandleHover={setHoveredNodeId}
            />
          )}
        </Box>

        {/* Status bar */}
        {!loading && !loadError && editorData && (
          <Stack direction="row" alignItems="center" spacing={2} sx={{ px: 0.5 }}>
            {belowCount === 0 && aboveCount === 0 ? (
              <Stack direction="row" alignItems="center" spacing={0.5}>
                <CheckCircleIcon sx={{ color: "#00e676", fontSize: 16 }} />
                <Typography variant="caption" color="#00e676">
                  All segments within AGL band
                </Typography>
              </Stack>
            ) : (
              <Stack direction="row" alignItems="center" spacing={0.5}>
                <WarningAmberIcon
                  sx={{ color: belowCount > 0 ? "#ff5252" : "#ff9100", fontSize: 16 }}
                />
                <Typography variant="caption" color={belowCount > 0 ? "#ff5252" : "#ff9100"}>
                  {belowCount > 0 &&
                    `${belowCount} point${belowCount > 1 ? "s" : ""} below min AGL`}
                  {belowCount > 0 && aboveCount > 0 && "  ·  "}
                  {aboveCount > 0 &&
                    `${aboveCount} point${aboveCount > 1 ? "s" : ""} above max AGL`}
                </Typography>
              </Stack>
            )}
            {minClearance != null && (
              <Typography variant="caption" color="text.disabled" sx={{ ml: "auto" }}>
                Min clearance: {Math.round(minClearance)} m
              </Typography>
            )}
          </Stack>
        )}

        {applyError && (
          <Typography variant="caption" color="error">
            {applyError}
          </Typography>
        )}

        {/* Footer actions */}
        <Stack
          direction="row"
          justifyContent="flex-end"
          spacing={1}
          sx={{ pt: 0.5, borderTop: "1px solid #21262d" }}
        >
          <Button
            variant="outlined"
            onClick={onClose}
            size="small"
            sx={{ textTransform: "none", borderColor: "#30363d", color: "text.secondary" }}
          >
            Close
          </Button>
          <Button
            variant="contained"
            size="small"
            startIcon={applying ? <CircularProgress size={14} color="inherit" /> : <SaveIcon />}
            onClick={handleApply}
            disabled={applying || loading || !!loadError}
            sx={{ textTransform: "none", fontWeight: 600 }}
          >
            {applying ? "Applying…" : "Apply to Mission"}
          </Button>
        </Stack>
      </DialogContent>
    </Dialog>
  );
}
