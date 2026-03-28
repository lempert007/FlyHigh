import React, { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Collapse,
  Dialog,
  DialogContent,
  Divider,
  Grid,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import DownloadIcon from "@mui/icons-material/Download";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import BatteryChargingFullIcon from "@mui/icons-material/BatteryChargingFull";
import BatteryAlertIcon from "@mui/icons-material/BatteryAlert";
import TimerIcon from "@mui/icons-material/Timer";
import ShieldIcon from "@mui/icons-material/Shield";
import RouteIcon from "@mui/icons-material/Route";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import FullscreenIcon from "@mui/icons-material/Fullscreen";
import GpsFixedIcon from "@mui/icons-material/GpsFixed";
import TuneIcon from "@mui/icons-material/Tune";
import CameraAltIcon from "@mui/icons-material/CameraAlt";
import JSZip from "jszip";
import { downloadBlob } from "../api";
import { haversineM, formatTime, getBatteryColor } from "../utils/math";
import type { PlanMeta } from "../types/mission";
import AltitudeEditorModal from "./AltitudeEditorModal";

interface AltWaypoint {
  lat: number;
  lon: number;
  alt_m: number;
}

interface AltitudeProfileProps {
  waypoints: AltWaypoint[] | null;
  H?: number;
}

function AltitudeProfile({ waypoints, H = 180 }: AltitudeProfileProps) {
  const [profileOpen, setProfileOpen] = useState(false);

  if (!waypoints || waypoints.length < 2) return null;

  const W = 440,
    PL = 42,
    PR = 8,
    PT = 8,
    PB = 24;
  const chartW = W - PL - PR;

  let dist = 0;
  const xs = [0];
  for (let i = 1; i < waypoints.length; i++) {
    dist += haversineM(waypoints[i - 1], waypoints[i]);
    xs.push(dist);
  }
  const totalDist = xs[xs.length - 1];

  const alts = waypoints.map((w) => w.alt_m);
  const minAlt = Math.min(...alts);
  const maxAlt = Math.max(...alts);
  const altRange = maxAlt - minAlt || 1;

  const cx = (d: number) => PL + (d / totalDist) * chartW;

  const svgContent = (svgH: number) => {
    const svgChartH = svgH - PT - PB;
    const svgCy = (a: number) => PT + svgChartH - ((a - minAlt) / altRange) * svgChartH;
    const svgPts = waypoints.map((w, i) => `${cx(xs[i])},${svgCy(w.alt_m)}`).join(" ");
    const svgYTicks = [minAlt, (minAlt + maxAlt) / 2, maxAlt].map((a) => ({
      a,
      y: svgCy(a),
      label: `${Math.round(a)}`,
    }));
    const svgXTicks = [0, totalDist / 2, totalDist].map((d) => ({
      d,
      x: cx(d),
      label: d >= 1000 ? `${(d / 1000).toFixed(1)}km` : `${Math.round(d)}m`,
    }));
    return (
      <>
        <polygon
          points={`${cx(0)},${PT + svgChartH} ${svgPts} ${cx(totalDist)},${PT + svgChartH}`}
          fill="rgba(30,144,255,0.15)"
        />
        <polyline points={svgPts} fill="none" stroke="#1E90FF" strokeWidth="1.5" />

        {svgYTicks.map(({ a, y, label }) => (
          <g key={a}>
            <line x1={PL - 3} y1={y} x2={PL} y2={y} stroke="#888" strokeWidth="1" />
            <text x={PL - 5} y={y + 4} textAnchor="end" fontSize="9" fill="#888">
              {label}
            </text>
          </g>
        ))}
        {svgXTicks.map(({ d, x, label }) => (
          <g key={d}>
            <line
              x1={x}
              y1={PT + svgChartH}
              x2={x}
              y2={PT + svgChartH + 3}
              stroke="#888"
              strokeWidth="1"
            />
            <text x={x} y={PT + svgChartH + 13} textAnchor="middle" fontSize="9" fill="#888">
              {label}
            </text>
          </g>
        ))}
        <line x1={PL} y1={PT} x2={PL} y2={PT + svgChartH} stroke="#555" strokeWidth="1" />
        <line
          x1={PL}
          y1={PT + svgChartH}
          x2={PL + chartW}
          y2={PT + svgChartH}
          stroke="#555"
          strokeWidth="1"
        />
        <text
          x={10}
          y={PT + svgChartH / 2}
          textAnchor="middle"
          fontSize="9"
          fill="#888"
          transform={`rotate(-90,10,${PT + svgChartH / 2})`}
        >
          m MSL
        </text>
      </>
    );
  };

  return (
    <Box sx={{ mt: 1, mb: 1 }}>
      <Box sx={{ display: "flex", alignItems: "center", mb: 0.5, gap: 1 }}>
        <Typography variant="caption" color="text.secondary">
          Altitude profile
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Button
          size="small"
          variant="text"
          onClick={() => setProfileOpen(true)}
          startIcon={<FullscreenIcon sx={{ fontSize: "0.9rem !important" }} />}
          sx={{
            textTransform: "none",
            fontSize: "0.65rem",
            py: 0,
            px: 0.5,
            minWidth: 0,
            color: "text.disabled",
          }}
        >
          Expand
        </Button>
      </Box>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block", overflow: "visible" }}>
        {svgContent(H)}
      </svg>
      <Dialog open={profileOpen} onClose={() => setProfileOpen(false)} maxWidth="md" fullWidth>
        <DialogContent sx={{ bgcolor: "#0d1117", p: 3 }}>
          <Typography variant="subtitle2" color="text.secondary" gutterBottom>
            Altitude profile
          </Typography>
          <svg
            width="100%"
            viewBox={`0 0 ${W} 320`}
            style={{ display: "block", overflow: "visible" }}
          >
            {svgContent(320)}
          </svg>
        </DialogContent>
      </Dialog>
    </Box>
  );
}

const KIND_LABEL: Record<string, string> = {
  terrain_band: "Terrain band too narrow",
  slope: "Slope limit exceeded",
  vertical: "Below surface model",
  horizontal: "Safety bubble obstacle",
  surface_warning: "Above max AGL",
  camera_range: "Camera range exceeded",
};

interface ViolationListProps {
  violations: {
    point_index: number;
    kind: string;
    description: string;
    lat: number;
    lon: number;
  }[];
  accentColor: string;
  onViolationClick?: (lat: number, lon: number) => void;
}

function ViolationList({ violations, accentColor, onViolationClick }: ViolationListProps) {
  return (
    <Stack spacing={0.5} sx={{ p: 0.75 }}>
      {violations.map((v, i) => {
        const canFly = v.lat != null && v.lon != null && onViolationClick;
        return (
          <Box
            key={i}
            onClick={canFly ? () => onViolationClick!(v.lat, v.lon) : undefined}
            sx={{
              display: "flex",
              alignItems: "flex-start",
              gap: 1,
              p: 0.75,
              bgcolor: `${accentColor}10`,
              borderRadius: 1,
              borderLeft: `3px solid ${accentColor}`,
              ...(canFly ? { cursor: "pointer", "&:hover": { bgcolor: `${accentColor}1a` } } : {}),
            }}
          >
            {canFly ? (
              <GpsFixedIcon sx={{ color: accentColor, fontSize: 14, mt: 0.2, flexShrink: 0 }} />
            ) : (
              <WarningAmberIcon sx={{ color: accentColor, fontSize: 14, mt: 0.2, flexShrink: 0 }} />
            )}
            <Box>
              <Typography variant="caption" color="text.disabled">
                #{v.point_index} · {KIND_LABEL[v.kind] ?? v.kind}
              </Typography>
              <Typography
                variant="caption"
                display="block"
                sx={{ color: "text.primary", fontSize: "0.72rem" }}
              >
                {v.description}
              </Typography>
            </Box>
          </Box>
        );
      })}
    </Stack>
  );
}

interface ResultsPanelProps {
  meta: PlanMeta | null;
  zipBlob: Blob | null;
  sessionId?: string | null;
  folder?: string | null;
  onViolationClick?: (lat: number, lon: number) => void;
  onAltitudesApplied?: (blob: Blob, meta: PlanMeta | null) => void;
  batteryWarningPct?: number;
  batteryErrorPct?: number;
  violationFilters?: { safety: boolean; product_poi: boolean; product_route: boolean };
  onToggleViolationCategory?: (cat: "safety" | "product_poi" | "product_route") => void;
}

const OUTPUT_FILES = [
  { name: "waypoints.json", label: "Waypoints JSON" },
  { name: "waypoints.kml", label: "Waypoints KML (Google Earth / DJI)" },
  { name: "mission_report.html", label: "Mission Report (Map + 3D + Profile)" },
];

export default function ResultsPanel({
  meta,
  zipBlob,
  sessionId,
  folder,
  onViolationClick,
  onAltitudesApplied,
  batteryWarningPct,
  batteryErrorPct,
  violationFilters,
  onToggleViolationCategory,
}: ResultsPanelProps) {
  const [open, setOpen] = useState({
    downloads: false,
    warnings: false,
    profile: false,
    safety: false,
    productPoi: false,
    productRte: false,
  });
  const toggle = (k: keyof typeof open) => setOpen((p) => ({ ...p, [k]: !p[k] }));
  const [profileWaypoints, setProfileWaypoints] = useState<AltWaypoint[] | null>(null);
  const [altEditorOpen, setAltEditorOpen] = useState(false);

  useEffect(() => {
    if (!zipBlob) return;
    let cancelled = false;
    JSZip.loadAsync(zipBlob)
      .then((zip) => {
        const f = zip.file("waypoints.json");
        if (!f) return;
        return f.async("string").then((txt) => {
          if (!cancelled) {
            try {
              setProfileWaypoints(JSON.parse(txt) as AltWaypoint[]);
            } catch {
              /* ignore */
            }
          }
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [zipBlob]);

  if (!meta || !zipBlob) return null;

  const violations = meta.violations ?? [];
  const safety = violations.filter((v) => v.category === "safety");
  const productPoi = violations.filter((v) => v.category === "product_poi");
  const productRte = violations.filter((v) => v.category === "product_route");

  const scanPct = meta.poi_scan_good_pct;
  const scanColor =
    scanPct == null ? "#888" : scanPct >= 90 ? "#00e676" : scanPct >= 70 ? "#ff9100" : "#ff5252";

  const batteryColor = getBatteryColor(meta.budget_pct, batteryWarningPct, batteryErrorPct);
  // Files that are internal plumbing — strip before handing the ZIP to the user.
  const INTERNAL_FILES = new Set([
    "meta.json",
    "agl_profile.json",
    "poi_bands.json",
    "waypoint_indices.json",
  ]);

  const handleDownloadAll = async () => {
    const src = await JSZip.loadAsync(zipBlob);
    const out = new JSZip();
    for (const [name, file] of Object.entries(src.files)) {
      if (!file.dir && !INTERNAL_FILES.has(name)) {
        out.file(name, await file.async("blob"));
      }
    }
    const clean = await out.generateAsync({ type: "blob", compression: "DEFLATE" });
    downloadBlob(clean, "flyhigh_mission.zip");
  };

  const handleDownloadFile = async (filename: string) => {
    const zip = await JSZip.loadAsync(zipBlob);
    const file = zip.file(filename);
    if (!file) return;
    downloadBlob(await file.async("blob"), filename);
  };

  const handleOpenReport = async () => {
    const zip = await JSZip.loadAsync(zipBlob);
    const file = zip.file("mission_report.html");
    if (!file) return;
    const url = URL.createObjectURL(new Blob([await file.async("blob")], { type: "text/html" }));
    window.open(url, "_blank");
  };

  return (
    <Box>
      {/* KPI cards */}
      <Grid container spacing={1} sx={{ mb: 1.5 }}>
        {(
          [
            {
              icon: <RouteIcon fontSize="small" />,
              value: `${(meta.total_distance_m / 1000).toFixed(2)} km`,
              label: "Distance",
              color: "#1E90FF",
            },
            {
              icon: <TimerIcon fontSize="small" />,
              value: formatTime(meta.flight_time_s),
              label: "Flight time",
              color: "#00e676",
            },
            {
              icon: <BatteryChargingFullIcon fontSize="small" />,
              value: `${meta.budget_pct.toFixed(0)}%`,
              label: "Battery",
              color: batteryColor,
            },
            {
              icon: <ShieldIcon fontSize="small" />,
              value:
                safety.length === 0
                  ? "Clear"
                  : `${safety.length} issue${safety.length > 1 ? "s" : ""}`,
              label: "Safety",
              color: safety.length === 0 ? "#00e676" : "#ff5252",
            },
            ...(scanPct != null
              ? [
                  {
                    icon: <CameraAltIcon fontSize="small" />,
                    value: `${scanPct.toFixed(0)}%`,
                    label: "Scan quality",
                    color: scanColor,
                  },
                ]
              : []),
          ] as { icon: React.ReactNode; value: string; label: string; color: string }[]
        ).map(({ icon, value, label, color }) => (
          <Grid item xs key={label}>
            <Paper
              variant="outlined"
              sx={{ p: 1, textAlign: "center", borderColor: "divider", bgcolor: "#0d1117" }}
            >
              <Box sx={{ color, mb: 0.25 }}>{icon}</Box>
              <Typography
                variant="h6"
                fontWeight={700}
                sx={{ color, lineHeight: 1.1, fontSize: "0.9rem" }}
              >
                {value}
              </Typography>
              <Typography variant="caption" color="text.disabled" sx={{ fontSize: "0.6rem" }}>
                {label}
              </Typography>
            </Paper>
          </Grid>
        ))}
      </Grid>

      {meta.error && (
        <Alert severity="error" icon={<ErrorOutlineIcon />} sx={{ mb: 1 }}>
          {meta.error}
        </Alert>
      )}
      {meta.warning && !meta.error && (
        <Alert severity="warning" icon={<WarningAmberIcon />} sx={{ mb: 1 }}>
          {meta.warning}
        </Alert>
      )}

      {violations.length === 0 ? (
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            p: 1,
            mb: 1,
            bgcolor: "rgba(0,230,118,0.08)",
            borderRadius: 1,
            border: "1px solid rgba(0,230,118,0.2)",
          }}
        >
          <CheckCircleIcon sx={{ color: "#00e676", fontSize: 18 }} />
          <Typography variant="body2" sx={{ color: "#00e676" }}>
            No violations — route is clear
          </Typography>
        </Box>
      ) : (
        <Stack spacing={0.75} sx={{ mb: 1 }}>
          {onToggleViolationCategory && (
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 0.25 }}>
              <Typography
                variant="caption"
                sx={{ fontSize: "0.62rem", color: "text.disabled", mr: 0.25 }}
              >
                Map:
              </Typography>
              {(
                [
                  { cat: "safety", label: "Safety", color: "#ff5252", has: safety.length > 0 },
                  {
                    cat: "product_poi",
                    label: "Scan",
                    color: "#ff9100",
                    has: productPoi.length > 0,
                  },
                  {
                    cat: "product_route",
                    label: "Transit",
                    color: "#ffd600",
                    has: productRte.length > 0,
                  },
                ] as const
              )
                .filter(({ has }) => has)
                .map(({ cat, label, color }) => {
                  const active = violationFilters?.[cat] ?? true;
                  return (
                    <Box
                      key={cat}
                      onClick={() => onToggleViolationCategory(cat)}
                      sx={{
                        px: 0.75,
                        py: 0.2,
                        borderRadius: 1,
                        cursor: "pointer",
                        fontSize: "0.62rem",
                        fontWeight: 600,
                        lineHeight: 1.4,
                        border: `1px solid ${color}`,
                        bgcolor: active ? `${color}22` : "transparent",
                        color: active ? color : "#555",
                        transition: "all 0.15s",
                        "&:hover": { bgcolor: `${color}33` },
                      }}
                    >
                      {label}
                    </Box>
                  );
                })}
            </Box>
          )}
          {/* ── Safety violations ── */}
          {safety.length > 0 && (
            <Box
              sx={{ border: "1px solid rgba(255,82,82,0.3)", borderRadius: 1, overflow: "hidden" }}
            >
              <Button
                size="small"
                variant="text"
                fullWidth
                endIcon={open.safety ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                onClick={() => toggle("safety")}
                sx={{
                  justifyContent: "flex-start",
                  textTransform: "none",
                  color: "#ff5252",
                  px: 1,
                  py: 0.75,
                  borderRadius: 0,
                  bgcolor: "rgba(255,82,82,0.07)",
                }}
              >
                <WarningAmberIcon sx={{ fontSize: 15, mr: 0.75 }} />
                <Box sx={{ flex: 1, textAlign: "left" }}>
                  <Typography
                    variant="caption"
                    sx={{
                      fontWeight: 700,
                      fontSize: "0.75rem",
                      display: "block",
                      color: "#ff5252",
                    }}
                  >
                    Safety Violations ({safety.length})
                  </Typography>
                  <Typography
                    variant="caption"
                    sx={{ fontSize: "0.62rem", color: "rgba(255,82,82,0.7)" }}
                  >
                    Flight safety compromised — re-plan required
                  </Typography>
                </Box>
              </Button>
              <Collapse in={open.safety}>
                <ViolationList
                  violations={safety}
                  accentColor="#ff5252"
                  onViolationClick={onViolationClick}
                />
              </Collapse>
            </Box>
          )}

          {/* ── Product violations — scan area ── */}
          {productPoi.length > 0 && (
            <Box
              sx={{ border: "1px solid rgba(255,145,0,0.3)", borderRadius: 1, overflow: "hidden" }}
            >
              <Button
                size="small"
                variant="text"
                fullWidth
                endIcon={open.productPoi ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                onClick={() => toggle("productPoi")}
                sx={{
                  justifyContent: "flex-start",
                  textTransform: "none",
                  color: "#ff9100",
                  px: 1,
                  py: 0.75,
                  borderRadius: 0,
                  bgcolor: "rgba(255,145,0,0.06)",
                }}
              >
                <CameraAltIcon sx={{ fontSize: 15, mr: 0.75 }} />
                <Box sx={{ flex: 1, textAlign: "left" }}>
                  <Typography
                    variant="caption"
                    sx={{
                      fontWeight: 700,
                      fontSize: "0.75rem",
                      display: "block",
                      color: "#ff9100",
                    }}
                  >
                    Scan Area Quality ({productPoi.length} issue{productPoi.length > 1 ? "s" : ""})
                  </Typography>
                  <Typography
                    variant="caption"
                    sx={{ fontSize: "0.62rem", color: "rgba(255,145,0,0.7)" }}
                  >
                    Drone above max AGL in scan area — imagery quality degraded
                  </Typography>
                </Box>
              </Button>
              {/* Scan quality progress bar — always visible */}
              {scanPct != null && (
                <Box sx={{ px: 1, pt: 0.75, pb: 0.5, bgcolor: "rgba(255,145,0,0.04)" }}>
                  <Box
                    sx={{
                      height: 5,
                      borderRadius: 3,
                      bgcolor: "#1c2128",
                      overflow: "hidden",
                      mb: 0.5,
                    }}
                  >
                    <Box
                      sx={{
                        height: "100%",
                        borderRadius: 3,
                        width: `${scanPct}%`,
                        background: `linear-gradient(90deg, ${scanColor}88, ${scanColor})`,
                        transition: "width 0.4s ease",
                      }}
                    />
                  </Box>
                  <Stack direction="row" justifyContent="space-between" alignItems="center">
                    <Typography
                      variant="caption"
                      sx={{ fontSize: "0.62rem", color: scanColor, fontWeight: 600 }}
                    >
                      {scanPct.toFixed(0)}% of scan area within product spec
                    </Typography>
                    {scanPct < 90 && (
                      <Typography
                        variant="caption"
                        sx={{ fontSize: "0.6rem", color: "#ff9100", fontStyle: "italic" }}
                      >
                        &gt;10% violated
                      </Typography>
                    )}
                  </Stack>
                </Box>
              )}
              <Collapse in={open.productPoi}>
                <ViolationList
                  violations={productPoi}
                  accentColor="#ff9100"
                  onViolationClick={onViolationClick}
                />
              </Collapse>
            </Box>
          )}

          {/* ── Product violations — transit route ── */}
          {productRte.length > 0 && (
            <Box
              sx={{ border: "1px solid rgba(255,214,0,0.25)", borderRadius: 1, overflow: "hidden" }}
            >
              <Button
                size="small"
                variant="text"
                fullWidth
                endIcon={open.productRte ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                onClick={() => toggle("productRte")}
                sx={{
                  justifyContent: "flex-start",
                  textTransform: "none",
                  color: "#ffd600",
                  px: 1,
                  py: 0.75,
                  borderRadius: 0,
                  bgcolor: "rgba(255,214,0,0.05)",
                }}
              >
                <RouteIcon sx={{ fontSize: 15, mr: 0.75 }} />
                <Box sx={{ flex: 1, textAlign: "left" }}>
                  <Typography
                    variant="caption"
                    sx={{
                      fontWeight: 700,
                      fontSize: "0.75rem",
                      display: "block",
                      color: "#ffd600",
                    }}
                  >
                    Transit Route Quality ({productRte.length} issue
                    {productRte.length > 1 ? "s" : ""})
                  </Typography>
                  <Typography
                    variant="caption"
                    sx={{ fontSize: "0.62rem", color: "rgba(255,214,0,0.6)" }}
                  >
                    Drone above max AGL on transit — may affect route imagery
                  </Typography>
                </Box>
              </Button>
              <Collapse in={open.productRte}>
                <ViolationList
                  violations={productRte}
                  accentColor="#ffd600"
                  onViolationClick={onViolationClick}
                />
              </Collapse>
            </Box>
          )}
        </Stack>
      )}

      {meta.budget_pct > (batteryWarningPct ?? 90) && (
        <>
          <Button
            size="small"
            variant="text"
            fullWidth
            endIcon={open.warnings ? <ExpandLessIcon /> : <ExpandMoreIcon />}
            onClick={() => toggle("warnings")}
            sx={{
              justifyContent: "flex-start",
              textTransform: "none",
              color: meta.budget_pct > (batteryErrorPct ?? 100) ? "error.main" : "warning.main",
              mb: 0.5,
            }}
          >
            {meta.budget_pct > (batteryErrorPct ?? 100)
              ? "Battery capacity exceeded"
              : "Battery warning"}
          </Button>
          <Collapse in={open.warnings}>
            {meta.budget_pct > (batteryErrorPct ?? 100) ? (
              <Alert severity="error" sx={{ mb: 1 }} icon={<BatteryAlertIcon />}>
                Mission exceeds battery capacity ({meta.budget_pct.toFixed(0)}%).
              </Alert>
            ) : (
              <Alert severity="warning" sx={{ mb: 1 }}>
                High battery usage ({meta.budget_pct.toFixed(0)}%). Consider reducing coverage area.
              </Alert>
            )}
          </Collapse>
        </>
      )}

      <Button
        size="small"
        variant="text"
        fullWidth
        endIcon={open.profile ? <ExpandLessIcon /> : <ExpandMoreIcon />}
        onClick={() => toggle("profile")}
        sx={{
          justifyContent: "flex-start",
          textTransform: "none",
          color: "text.secondary",
          mb: 0.5,
        }}
      >
        Altitude Profile
      </Button>
      <Collapse in={open.profile}>
        <AltitudeProfile waypoints={profileWaypoints} H={110} />
      </Collapse>

      <Divider sx={{ my: 1.5 }} />

      {/* Manual altitude editor */}
      {(sessionId || folder) && meta?.min_agl_m != null && meta?.max_agl_m != null && (
        <>
          <Button
            fullWidth
            size="small"
            variant="outlined"
            startIcon={<TuneIcon />}
            onClick={() => setAltEditorOpen(true)}
            sx={{
              textTransform: "none",
              mb: 1,
              borderColor: "#1E90FF44",
              color: "#1E90FF",
              "&:hover": { borderColor: "#1E90FF", bgcolor: "rgba(30,144,255,0.07)" },
            }}
          >
            Edit Altitudes Manually
          </Button>
          <AltitudeEditorModal
            open={altEditorOpen}
            onClose={() => setAltEditorOpen(false)}
            sessionId={sessionId ?? null}
            folder={folder}
            minAgl={meta.min_agl_m}
            maxAgl={meta.max_agl_m}
            onApplied={(blob, updatedMeta) => onAltitudesApplied?.(blob, updatedMeta)}
          />
        </>
      )}

      <Stack direction="row" spacing={1} sx={{ mb: 1.5 }}>
        <Button
          variant="contained"
          fullWidth
          startIcon={<DownloadIcon />}
          onClick={handleDownloadAll}
          size="small"
        >
          Download Package
        </Button>
        <Button
          variant="outlined"
          fullWidth
          startIcon={<OpenInNewIcon />}
          onClick={handleOpenReport}
          size="small"
          sx={{ textTransform: "none" }}
        >
          Open Report
        </Button>
      </Stack>

      <Button
        size="small"
        fullWidth
        variant="text"
        endIcon={open.downloads ? <ExpandLessIcon /> : <ExpandMoreIcon />}
        onClick={() => toggle("downloads")}
        sx={{
          justifyContent: "flex-start",
          textTransform: "none",
          color: "text.secondary",
          mb: 0.5,
        }}
      >
        More downloads
      </Button>
      <Collapse in={open.downloads}>
        <Stack spacing={0.75} mb={1}>
          {OUTPUT_FILES.map(({ name, label }) => (
            <Button
              key={name}
              size="small"
              variant="outlined"
              fullWidth
              startIcon={<DownloadIcon />}
              onClick={() => handleDownloadFile(name)}
              sx={{ justifyContent: "flex-start", textTransform: "none" }}
            >
              {label}
            </Button>
          ))}
        </Stack>
      </Collapse>
    </Box>
  );
}
