/**
 * Plotly-based altitude profile chart for the interactive altitude editor.
 *
 * Renders terrain fill, safety/camera reference lines, AGL floor/ceiling,
 * and the flight altitude trace. Zone backgrounds are coloured by segment type.
 * Clicking a point selects it in the inspector panel.
 */

import { useMemo, useCallback, useState } from "react";
import createPlotlyComponent from "react-plotly.js/factory";
// @ts-expect-error - plotly.js-basic-dist-min has no TS default export
import Plotly from "plotly.js-basic-dist-min";
import type { ProfilePoint } from "../../types/mission";
import type { ValidationStatus } from "../../utils/altitudeEditorUtils";
import { buildZoneShapes } from "../../utils/altitudeEditorUtils";

const Plot = createPlotlyComponent(Plotly);

interface AltitudeChartProps {
  terrain: number[];
  cumDists: number[];
  alts: number[];
  aglProfile: number[];
  minBand: number[];
  maxBand: number[];
  validation: ValidationStatus[];
  profilePoints: ProfilePoint[];
  bubblePeakTerrain: number[] | null;
  cameraMinTerrain: number[] | null;
  selectedIdx: number | null;
  selectedRangeEnd: number | null;
  onSelectIdx: (idx: number | null) => void;
  onSelectRangeEnd: (idx: number | null) => void;
}

const DARK_BG = "#0d1117";
const GRID_COLOR = "#21262d";
const TEXT_COLOR = "#c9d1d9";

export default function AltitudeChart({
  terrain,
  cumDists,
  alts,
  aglProfile,
  minBand,
  maxBand,
  validation,
  profilePoints,
  bubblePeakTerrain,
  cameraMinTerrain,
  selectedIdx,
  selectedRangeEnd,
  onSelectIdx,
  onSelectRangeEnd,
}: AltitudeChartProps) {
  const zoneShapes = useMemo(() => buildZoneShapes(profilePoints), [profilePoints]);

  // Preserve zoom: capture axis ranges set by the user and pass them back into layout
  const [savedXRange, setSavedXRange] = useState<[number, number] | null>(null);
  const [savedYRange, setSavedYRange] = useState<[number, number] | null>(null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleRelayout = useCallback((eventData: any) => {
    if (eventData["xaxis.range[0]"] !== undefined) {
      setSavedXRange([eventData["xaxis.range[0]"], eventData["xaxis.range[1]"]]);
    } else if (eventData["xaxis.autorange"] === true) {
      setSavedXRange(null);
    }
    if (eventData["yaxis.range[0]"] !== undefined) {
      setSavedYRange([eventData["yaxis.range[0]"], eventData["yaxis.range[1]"]]);
    } else if (eventData["yaxis.autorange"] === true) {
      setSavedYRange(null);
    }
  }, []);

  const markerColors = useMemo(
    () =>
      alts.map((_, i) => {
        if (i === selectedIdx) return "#00b0ff";
        if (validation[i] === "below") return "#ff5252";
        if (validation[i] === "above") return "#ff9100";
        return "#388bfd";
      }),
    [alts, selectedIdx, validation]
  );

  const markerSizes = useMemo(
    () => alts.map((_, i) => (i === selectedIdx ? 10 : 4)),
    [alts, selectedIdx]
  );

  const aglFloorY = useMemo(() => terrain.map((t, i) => t + (minBand[i] ?? 0)), [terrain, minBand]);

  const aglCeilY = useMemo(() => terrain.map((t, i) => t + (maxBand[i] ?? 0)), [terrain, maxBand]);

  const traces = useMemo(() => {
    const t: object[] = [];

    t.push({
      x: cumDists,
      y: terrain,
      type: "scatter",
      mode: "lines",
      fill: "tozeroy",
      fillcolor: "rgba(100,100,100,0.25)",
      line: { color: "rgba(140,140,140,0.5)", width: 1 },
      name: "Terrain",
      hovertemplate: "%{y:.1f} m<extra>Terrain</extra>",
    });

    t.push({
      x: cumDists,
      y: aglFloorY,
      type: "scatter",
      mode: "lines",
      line: { color: "rgba(0,230,118,0.5)", width: 1, dash: "dot" },
      name: "Min AGL",
      hovertemplate: "%{y:.1f} m<extra>Min AGL floor</extra>",
    });

    t.push({
      x: cumDists,
      y: aglCeilY,
      type: "scatter",
      mode: "lines",
      line: { color: "rgba(255,145,0,0.4)", width: 1, dash: "dot" },
      name: "Max AGL",
      hovertemplate: "%{y:.1f} m<extra>Max AGL ceiling</extra>",
    });

    if (bubblePeakTerrain) {
      t.push({
        x: cumDists,
        y: bubblePeakTerrain,
        type: "scatter",
        mode: "lines",
        line: { color: "rgba(255,145,0,0.7)", width: 1, dash: "dash" },
        name: "Safety bubble peak",
        hovertemplate: "%{y:.1f} m<extra>Safety bubble peak</extra>",
      });
    }

    if (cameraMinTerrain) {
      t.push({
        x: cumDists,
        y: cameraMinTerrain,
        type: "scatter",
        mode: "lines",
        line: { color: "rgba(239,83,80,0.6)", width: 1, dash: "dash" },
        name: "Camera min terrain",
        hovertemplate: "%{y:.1f} m<extra>Camera min terrain</extra>",
      });
    }

    // Flight altitude trace (always last — index used in click handler)
    t.push({
      x: cumDists,
      y: alts,
      type: "scatter",
      mode: "lines+markers",
      line: { color: "#e6edf3", width: 2 },
      marker: { color: markerColors, size: markerSizes, symbol: "circle" },
      name: "Flight altitude",
      customdata: aglProfile,
      hovertemplate: "Alt: %{y:.1f} m | AGL: %{customdata:.1f} m<extra>Flight</extra>",
    });

    return t;
  }, [
    cumDists,
    terrain,
    alts,
    aglFloorY,
    aglCeilY,
    aglProfile,
    bubblePeakTerrain,
    cameraMinTerrain,
    markerColors,
    markerSizes,
  ]);

  const selectionShape = useMemo(() => {
    if (selectedIdx === null || selectedIdx >= cumDists.length) return [];
    // Range selected: filled rect between the two endpoints
    if (selectedRangeEnd !== null && selectedRangeEnd !== selectedIdx) {
      const lo = Math.min(selectedIdx, selectedRangeEnd);
      const hi = Math.max(selectedIdx, selectedRangeEnd);
      return [
        {
          type: "rect",
          xref: "x",
          yref: "paper",
          x0: cumDists[lo],
          x1: cumDists[hi],
          y0: 0,
          y1: 1,
          fillcolor: "rgba(0,176,255,0.10)",
          line: { color: "#00b0ff", width: 1 },
          layer: "below",
        },
      ];
    }
    // Single point: dotted vertical line
    return [
      {
        type: "line",
        xref: "x",
        yref: "paper",
        x0: cumDists[selectedIdx],
        x1: cumDists[selectedIdx],
        y0: 0,
        y1: 1,
        line: { color: "#00b0ff", width: 1, dash: "dot" },
      },
    ];
  }, [selectedIdx, selectedRangeEnd, cumDists]);

  const layout = useMemo(
    () => ({
      paper_bgcolor: DARK_BG,
      plot_bgcolor: DARK_BG,
      margin: { l: 60, r: 20, t: 20, b: 50 },
      xaxis: {
        title: { text: "Distance (m)", font: { color: TEXT_COLOR, size: 12 } },
        color: TEXT_COLOR,
        gridcolor: GRID_COLOR,
        zerolinecolor: "#30363d",
        tickfont: { color: TEXT_COLOR, size: 11 },
        ...(savedXRange ? { range: savedXRange, autorange: false } : {}),
      },
      yaxis: {
        title: { text: "Altitude MSL (m)", font: { color: TEXT_COLOR, size: 12 } },
        color: TEXT_COLOR,
        gridcolor: GRID_COLOR,
        zerolinecolor: "#30363d",
        tickfont: { color: TEXT_COLOR, size: 11 },
        ...(savedYRange ? { range: savedYRange, autorange: false } : {}),
      },
      legend: {
        font: { color: TEXT_COLOR, size: 11 },
        bgcolor: "rgba(13,17,23,0.8)",
        bordercolor: GRID_COLOR,
        borderwidth: 1,
      },
      dragmode: "zoom" as const,
      shapes: [...zoneShapes, ...selectionShape],
      hovermode: "closest" as const,
    }),
    [zoneShapes, selectionShape, savedXRange, savedYRange]
  );

  const handleClick = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (event: any) => {
      if (!event.points || event.points.length === 0) return;
      const pt = event.points[0];
      if (pt.curveNumber !== traces.length - 1) return;
      const idx = pt.pointIndex as number;
      const shiftHeld = (event.event as MouseEvent | undefined)?.shiftKey ?? false;
      if (shiftHeld && selectedIdx !== null) {
        // Shift-click: extend or clear the range
        onSelectRangeEnd(idx === selectedRangeEnd ? null : idx);
      } else {
        // Normal click: set anchor, clear range
        onSelectRangeEnd(null);
        onSelectIdx(idx === selectedIdx ? null : idx);
      }
    },
    [traces.length, selectedIdx, selectedRangeEnd, onSelectIdx, onSelectRangeEnd]
  );

  return (
    <Plot
      data={traces as never[]}
      layout={layout as never}
      config={{
        displayModeBar: true,
        modeBarButtonsToRemove: ["sendDataToCloud"],
        responsive: true,
        displaylogo: false,
      }}
      style={{ width: "100%", height: "100%" }}
      useResizeHandler
      onClick={handleClick}
      onRelayout={handleRelayout}
    />
  );
}
