/**
 * SVG altitude profile chart used inside the AltitudeEditorModal.
 *
 * Displays terrain, AGL band, POI blocks, segment bars, drone profile,
 * axes, and draggable handle circles.
 */

import { useMemo } from "react";
import type { AltNode } from "../../utils/altitudeEditorUtils";
import type { validateAltitudes } from "../../utils/altitudeEditorUtils";

// ── Layout constants ──────────────────────────────────────────────────────────

export const SVG_W = 900;
export const SVG_H = 380;
export const PL = 48; // left padding (y-axis labels)
export const PR = 16; // right padding
export const PT = 16; // top padding
export const PB = 28; // bottom padding (x-axis labels)
export const CHART_W = SVG_W - PL - PR;
export const CHART_H = SVG_H - PT - PB;

export const HANDLE_R = 7;
export const POI_HANDLE_R = 8;

// ── Colors ────────────────────────────────────────────────────────────────────

export const C_TERRAIN = "#6b4e2a";
export const C_AGL_FILL = "rgba(0,200,83,0.12)";
export const C_AGL_LINE = "rgba(0,200,83,0.35)";
export const C_PROFILE = "#1E90FF";
export const C_BELOW = "#ff5252";
export const C_ABOVE = "#ff9100";
export const C_POI_BG = "rgba(0,184,212,0.10)";
export const C_POI_LINE = "rgba(0,184,212,0.4)";
export const C_HANDLE = "#1E90FF";
export const C_HANDLE_INS = "#00e676";
export const C_LAND = "#aaa";
export const C_AXIS = "#555";
export const C_LABEL = "#6e7681";

// ── DragState union ───────────────────────────────────────────────────────────

export type DragState =
  | { type: "handle"; id: string; altMin: number; altRange: number }
  | {
      type: "segment";
      idA: string;
      idB: string;
      initialAltA: number;
      initialAltB: number;
      startSvgY: number;
      hasMoved: boolean;
      distA: number;
      distB: number;
      totalDist: number;
      altMin: number;
      altRange: number;
      isDraggable: boolean;
    };

// ── SegmentBar ────────────────────────────────────────────────────────────────

export interface SegmentBar {
  key: string;
  idA: string;
  idB: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  distA: number;
  distB: number;
  isDraggable: boolean;
}

// ── Coordinate helpers ────────────────────────────────────────────────────────

/**
 * Computes coordinate helpers from the ORIGINAL (algorithm) altitudes so the
 * Y-axis never rescales while the user is dragging handles.
 */
export function makeScales(
  totalDist: number,
  origAlts: number[],
  terrain: number[],
  maxAgl: number
) {
  const altMin = Math.min(...origAlts, ...terrain) - 5;
  const altMax = Math.max(...origAlts, ...terrain.map((t) => t + maxAgl)) + 10;
  const altRange = altMax - altMin || 1;

  const cx = (d: number) => PL + (d / totalDist) * CHART_W;
  const cy = (a: number) => PT + CHART_H - ((a - altMin) / altRange) * CHART_H;
  const toAlt = (svgY: number) => altMin + ((PT + CHART_H - svgY) / CHART_H) * altRange;
  const toDist = (svgX: number) => ((svgX - PL) / CHART_W) * totalDist;

  return { cx, cy, toAlt, toDist, altMin, altMax, altRange };
}

export function clientToSvg(clientX: number, clientY: number, svgEl: SVGSVGElement) {
  const bbox = svgEl.getBoundingClientRect();
  const scaleX = SVG_W / bbox.width;
  const scaleY = SVG_H / bbox.height;
  return { x: (clientX - bbox.left) * scaleX, y: (clientY - bbox.top) * scaleY };
}

// ── Chart component ───────────────────────────────────────────────────────────

interface ChartProps {
  origAlts: number[];
  terrain: number[];
  cumDists: number[];
  reconAlt: number[];
  validation: ReturnType<typeof validateAltitudes>;
  nodes: AltNode[];
  minBand: number[];
  maxBand: number[];
  maxAgl: number;
  dragState: DragState | null;
  hoveredSegmentKey: string | null;
  hoveredNodeId: string | null;
  onHandlePointerDown: (e: React.PointerEvent<SVGCircleElement>, nodeId: string) => void;
  onSegmentPointerDown: (e: React.PointerEvent<SVGLineElement>, seg: SegmentBar) => void;
  onPointerMove: (e: React.PointerEvent<SVGSVGElement>) => void;
  onPointerUp: (e: React.PointerEvent<SVGSVGElement>) => void;
  onNodeDblClick: (nodeId: string, nodeType: AltNode["type"]) => void;
  onSegmentHover: (key: string | null) => void;
  onHandleHover: (id: string | null) => void;
}

export function AltitudeChart({
  origAlts,
  terrain,
  cumDists,
  reconAlt,
  validation,
  nodes,
  minBand,
  maxBand,
  maxAgl,
  dragState,
  hoveredSegmentKey,
  hoveredNodeId,
  onHandlePointerDown,
  onSegmentPointerDown,
  onPointerMove,
  onPointerUp,
  onNodeDblClick,
  onSegmentHover,
  onHandleHover,
}: ChartProps) {
  const totalDist = cumDists[cumDists.length - 1] || 1;

  // Scale frozen to original altitudes — never changes during drag.
  const scales = useMemo(
    () => makeScales(totalDist, origAlts, terrain, maxAgl),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [totalDist, terrain, maxAgl]
  );
  const { cx, cy, altMin, altMax } = scales;

  // ── Terrain polygon ──────────────────────────────────────────────────────
  const terrainPts = terrain.map((t, i) => `${cx(cumDists[i])},${cy(t)}`).join(" ");
  const terrainPoly = `${cx(0)},${cy(altMin)} ${terrainPts} ${cx(totalDist)},${cy(altMin)}`;

  // ── AGL band (per-point, supports POI overrides) ─────────────────────────
  const minBandPts = terrain.map((t, i) => `${cx(cumDists[i])},${cy(t + minBand[i])}`).join(" ");
  const maxBandPts = terrain.map((t, i) => `${cx(cumDists[i])},${cy(t + maxBand[i])}`).join(" ");
  const maxBandPtsRev = terrain
    .map((_t, i) => {
      const ri = terrain.length - 1 - i;
      return `${cx(cumDists[ri])},${cy(terrain[ri] + maxBand[ri])}`;
    })
    .join(" ");
  const aglBandPoly = `${minBandPts} ${maxBandPtsRev}`;

  // ── Drone profile segments coloured by validation ────────────────────────
  type Seg = { pts: string; color: string };
  const segments: Seg[] = [];
  if (reconAlt.length > 1) {
    let segPts = `${cx(cumDists[0])},${cy(reconAlt[0])}`;
    let segColor =
      validation[0] === "below" ? C_BELOW : validation[0] === "above" ? C_ABOVE : C_PROFILE;
    for (let i = 1; i < reconAlt.length; i++) {
      const c =
        validation[i] === "below" ? C_BELOW : validation[i] === "above" ? C_ABOVE : C_PROFILE;
      if (c !== segColor) {
        segments.push({ pts: segPts, color: segColor });
        segPts = `${cx(cumDists[i - 1])},${cy(reconAlt[i - 1])} `;
        segColor = c;
      }
      segPts += ` ${cx(cumDists[i])},${cy(reconAlt[i])}`;
    }
    segments.push({ pts: segPts, color: segColor });
  }

  // ── Y-axis ticks ─────────────────────────────────────────────────────────
  const yTicks = [altMin, (altMin + altMax) / 2, altMax].map((a) => ({
    a: Math.round(a),
    y: cy(a),
  }));

  // ── X-axis ticks ─────────────────────────────────────────────────────────
  const xTicks = [0, totalDist / 2, totalDist].map((d) => ({
    x: cx(d),
    label: d >= 1000 ? `${(d / 1000).toFixed(1)} km` : `${Math.round(d)} m`,
  }));

  // ── POI block rects ───────────────────────────────────────────────────────
  const poiBlocks = nodes
    .filter(
      (n) => n.type === "poi" && n.poi_start_dist_m !== undefined && n.poi_end_dist_m !== undefined
    )
    .map((n) => {
      const x1 = cx(n.poi_start_dist_m!);
      const x2 = cx(n.poi_end_dist_m!);
      return { id: n.id, x: x1, w: x2 - x1 };
    });

  // ── Handle positions ──────────────────────────────────────────────────────
  const handles = nodes.map((n) => {
    const closestIdx = cumDists.reduce(
      (best, d, i) => (Math.abs(d - n.dist_m) < Math.abs(cumDists[best] - n.dist_m) ? i : best),
      0
    );
    const altAtNode = reconAlt[closestIdx] ?? n.alt_m;
    return { ...n, svgX: cx(n.dist_m), svgY: cy(altAtNode) };
  });

  // ── Segment bars between consecutive handles ──────────────────────────────
  const segmentBars: SegmentBar[] = [];
  for (let i = 0; i < handles.length - 1; i++) {
    const a = handles[i];
    const b = handles[i + 1];
    const isDraggable =
      a.type !== "start" && a.type !== "land" && b.type !== "start" && b.type !== "land";
    segmentBars.push({
      key: `${a.id}__${b.id}`,
      idA: a.id,
      idB: b.id,
      x1: a.svgX,
      y1: a.svgY,
      x2: b.svgX,
      y2: b.svgY,
      distA: a.dist_m,
      distB: b.dist_m,
      isDraggable,
    });
  }

  // ── Cursor for SVG root ───────────────────────────────────────────────────
  const svgCursor =
    dragState?.type === "handle"
      ? "grabbing"
      : dragState?.type === "segment"
        ? "ns-resize"
        : "default";

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${SVG_W} ${SVG_H}`}
      style={{ display: "block", overflow: "visible", cursor: svgCursor }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {/* 1. Terrain */}
      <polygon points={terrainPoly} fill={C_TERRAIN} opacity={0.55} />

      {/* 2. AGL band fill + dotted lines */}
      <polygon points={aglBandPoly} fill={C_AGL_FILL} />
      <polyline
        points={minBandPts}
        fill="none"
        stroke={C_AGL_LINE}
        strokeWidth={1}
        strokeDasharray="4 3"
      />
      <polyline
        points={maxBandPts}
        fill="none"
        stroke={C_AGL_LINE}
        strokeWidth={1}
        strokeDasharray="4 3"
      />

      {/* 3. POI block backgrounds */}
      {poiBlocks.map((b) => (
        <rect
          key={b.id}
          x={b.x}
          y={PT}
          width={b.w}
          height={CHART_H}
          fill={C_POI_BG}
          stroke={C_POI_LINE}
          strokeWidth={1}
          strokeDasharray="4 2"
        />
      ))}

      {/* 4. Segment bars (visible line + fat transparent hit target) */}
      {segmentBars.map((seg) => {
        const hovered = hoveredSegmentKey === seg.key;
        const isDragging =
          dragState?.type === "segment" && dragState.idA === seg.idA && dragState.idB === seg.idB;
        const active = hovered || isDragging;
        return (
          <g key={seg.key}>
            {/* Visible bar */}
            <line
              x1={seg.x1}
              y1={seg.y1}
              x2={seg.x2}
              y2={seg.y2}
              stroke={C_PROFILE}
              strokeWidth={active ? 6 : 3}
              strokeOpacity={active ? 0.6 : 0.25}
              strokeLinecap="round"
              pointerEvents="none"
            />
            {/* Transparent fat hit target */}
            <line
              x1={seg.x1}
              y1={seg.y1}
              x2={seg.x2}
              y2={seg.y2}
              stroke="transparent"
              strokeWidth={20}
              style={{ cursor: seg.isDraggable ? "ns-resize" : "crosshair" }}
              onPointerEnter={() => onSegmentHover(seg.key)}
              onPointerLeave={() => onSegmentHover(null)}
              onPointerDown={(e) => {
                e.stopPropagation();
                onSegmentPointerDown(e as unknown as React.PointerEvent<SVGLineElement>, seg);
              }}
            />
          </g>
        );
      })}

      {/* 5. Drone altitude profile (coloured by validation) */}
      {segments.map((s, i) => (
        <polyline
          key={i}
          points={s.pts}
          fill="none"
          stroke={s.color}
          strokeWidth={2}
          strokeLinejoin="round"
        />
      ))}

      {/* 6. Axes */}
      <line x1={PL} y1={PT} x2={PL} y2={PT + CHART_H} stroke={C_AXIS} strokeWidth={1} />
      <line
        x1={PL}
        y1={PT + CHART_H}
        x2={PL + CHART_W}
        y2={PT + CHART_H}
        stroke={C_AXIS}
        strokeWidth={1}
      />

      {/* Y-axis ticks */}
      {yTicks.map(({ a, y }) => (
        <g key={a}>
          <line x1={PL - 4} y1={y} x2={PL} y2={y} stroke={C_AXIS} strokeWidth={1} />
          <text x={PL - 6} y={y + 4} textAnchor="end" fontSize={9} fill={C_LABEL}>
            {a}
          </text>
        </g>
      ))}
      <text
        x={10}
        y={PT + CHART_H / 2}
        textAnchor="middle"
        fontSize={9}
        fill={C_LABEL}
        transform={`rotate(-90,10,${PT + CHART_H / 2})`}
      >
        m MSL
      </text>

      {/* X-axis ticks */}
      {xTicks.map(({ x, label }) => (
        <g key={label}>
          <line
            x1={x}
            y1={PT + CHART_H}
            x2={x}
            y2={PT + CHART_H + 4}
            stroke={C_AXIS}
            strokeWidth={1}
          />
          <text x={x} y={PT + CHART_H + 14} textAnchor="middle" fontSize={9} fill={C_LABEL}>
            {label}
          </text>
        </g>
      ))}

      {/* 7. Handles */}
      {handles.map((h) => {
        const isPoi = h.type === "poi";
        const isIns = h.type === "inserted";
        const isFixed = h.type === "land" || h.type === "start";
        const r = isPoi ? POI_HANDLE_R : HANDLE_R;
        const fill = isIns
          ? C_HANDLE_INS
          : h.type === "land"
            ? C_LAND
            : isPoi
              ? "#00bcd4"
              : C_HANDLE;

        const isHandleDragging =
          (dragState?.type === "handle" && dragState.id === h.id) ||
          (dragState?.type === "segment" && (dragState.idA === h.id || dragState.idB === h.id));
        const isHovered = hoveredNodeId === h.id;
        const showLabel = isHandleDragging || isHovered;

        return (
          <g key={h.id}>
            {isHovered && !isHandleDragging && (
              <circle
                cx={h.svgX}
                cy={h.svgY}
                r={r + 4}
                fill="none"
                stroke="white"
                strokeWidth={1.5}
                opacity={0.3}
              />
            )}
            {isHandleDragging && (
              <circle cx={h.svgX} cy={h.svgY} r={r + 6} fill={fill} opacity={0.18} />
            )}
            <circle
              cx={h.svgX}
              cy={h.svgY}
              r={r}
              fill={fill}
              stroke="#0d1117"
              strokeWidth={1.5}
              style={{ cursor: isFixed ? "default" : "grab" }}
              onPointerEnter={() => onHandleHover(h.id)}
              onPointerLeave={() => onHandleHover(null)}
              onPointerDown={(e) => {
                if (!isFixed) {
                  e.stopPropagation();
                  onHandlePointerDown(e as unknown as React.PointerEvent<SVGCircleElement>, h.id);
                }
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                onNodeDblClick(h.id, h.type);
              }}
            />
            {showLabel && (
              <text
                x={h.svgX}
                y={h.svgY - r - 6}
                textAnchor="middle"
                fontSize={9}
                fill={fill}
                fontWeight="bold"
                style={{ pointerEvents: "none", userSelect: "none" }}
              >
                {Math.round(h.alt_m)} m
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
