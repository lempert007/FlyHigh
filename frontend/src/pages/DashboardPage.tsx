import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Alert,
  Box,
  CircularProgress,
  CssBaseline,
  IconButton,
  ThemeProvider,
  Tooltip,
  Typography,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import DroneIcon from "../components/DroneIcon";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import {
  MapContainer,
  CircleMarker,
  Popup,
  TileLayer,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import { appTheme } from "../theme";
import { getDashboardStats } from "../api";
import type { DashboardStats, MissionPin, MissionStatus } from "../types/mission";
import { relativeDate, formatArea } from "../utils/math";
import { STATUS_COLOR, STATUS_LABEL } from "../utils/missionStatus";

// ── Donut chart (pure SVG) ────────────────────────────────────────────────────

interface DonutSegment {
  label: string;
  value: number;
  color: string;
}

function DonutChart({ segments }: { segments: DonutSegment[] }) {
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  const R = 38;
  const CX = 56;
  const CY = 56;
  const circumference = 2 * Math.PI * R;

  let offset = 0;
  const arcs = segments.map((seg) => {
    const fraction = total > 0 ? seg.value / total : 0;
    const dash = fraction * circumference;
    const gap = circumference - dash;
    const rotation = (offset / circumference) * 360 - 90;
    offset += dash;
    return { ...seg, dash, gap, rotation };
  });

  return (
    <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1.5 }}>
      <svg width={112} height={112} viewBox="0 0 112 112">
        {/* Background ring */}
        <circle cx={CX} cy={CY} r={R} fill="none" stroke="#21262d" strokeWidth={14} />
        {/* Segments */}
        {arcs.map((arc) =>
          arc.dash > 0 ? (
            <circle
              key={arc.label}
              cx={CX}
              cy={CY}
              r={R}
              fill="none"
              stroke={arc.color}
              strokeWidth={14}
              strokeDasharray={`${arc.dash} ${arc.gap}`}
              strokeDashoffset={0}
              transform={`rotate(${arc.rotation} ${CX} ${CY})`}
            />
          ) : null
        )}
        {/* Centre label */}
        <text x={CX} y={CY - 6} textAnchor="middle" fill="#cdd9e5" fontSize={18} fontWeight={700}>
          {total}
        </text>
        <text x={CX} y={CY + 10} textAnchor="middle" fill="#8b949e" fontSize={9} letterSpacing={1}>
          MISSIONS
        </text>
      </svg>

      {/* Legend */}
      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5, width: "100%" }}>
        {segments.map((seg) => (
          <Box key={seg.label} sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: seg.color, flexShrink: 0 }} />
            <Typography sx={{ fontSize: "0.72rem", color: "#8b949e", flex: 1 }}>{seg.label}</Typography>
            <Typography sx={{ fontSize: "0.72rem", color: "#cdd9e5", fontWeight: 600 }}>{seg.value}</Typography>
            <Typography sx={{ fontSize: "0.65rem", color: "#444c56" }}>
              {total > 0 ? `${Math.round((seg.value / total) * 100)}%` : "0%"}
            </Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <Box
      sx={{
        flex: "1 1 200px",
        minWidth: 180,
        bgcolor: "#161b22",
        border: "1px solid #21262d",
        borderRadius: 2,
        p: 2.5,
        display: "flex",
        flexDirection: "column",
        gap: 1,
      }}
    >
      <Typography
        sx={{
          fontSize: "0.65rem",
          fontWeight: 700,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "#444c56",
          mb: 0.5,
        }}
      >
        {label}
      </Typography>
      {children}
    </Box>
  );
}

// ── Map auto-fit helper ───────────────────────────────────────────────────────

function MapFitBounds({ pins }: { pins: MissionPin[] }) {
  const map = useMap();
  const fittedRef = useRef(false);

  useEffect(() => {
    if (fittedRef.current) return;
    const valid = pins.filter((p) => p.lat !== null && p.lon !== null);
    if (valid.length === 0) return;
    const bounds = L.latLngBounds(valid.map((p) => [p.lat!, p.lon!]));
    map.fitBounds(bounds, { padding: [48, 48], maxZoom: 14 });
    fittedRef.current = true;
  }, [map, pins]);

  return null;
}

// ── Status badge (inline) ─────────────────────────────────────────────────────

function StatusBadge({ status }: { status: MissionStatus }) {
  const color = STATUS_COLOR[status] ?? STATUS_COLOR.draft;
  return (
    <Box
      component="span"
      sx={{
        display: "inline-flex", alignItems: "center",
        px: 0.75, py: 0.2, borderRadius: "999px",
        bgcolor: `${color}1a`, border: `1px solid ${color}44`,
        fontSize: "0.6rem", fontWeight: 700, letterSpacing: "0.05em",
        textTransform: "uppercase", color, lineHeight: 1.6,
      }}
    >
      {STATUS_LABEL[status] ?? status}
    </Box>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const navigate = useNavigate();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setStats(await getDashboardStats());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const statusSegments: DonutSegment[] = [
    { label: "Draft", value: stats?.missions_by_status["draft"] ?? 0, color: STATUS_COLOR.draft },
    { label: "Ready", value: stats?.missions_by_status["ready"] ?? 0, color: STATUS_COLOR.ready },
    { label: "Flown", value: stats?.missions_by_status["flown"] ?? 0, color: STATUS_COLOR.flown },
  ];

  const validPins = (stats?.mission_pins ?? []).filter((p) => p.lat !== null && p.lon !== null);
  const defaultCenter: [number, number] = validPins.length > 0
    ? [validPins[0].lat!, validPins[0].lon!]
    : [30, 15];

  return (
    <ThemeProvider theme={appTheme}>
      <CssBaseline />
      <Box sx={{ minHeight: "100vh", bgcolor: "background.default", display: "flex", flexDirection: "column" }}>

        {/* Top bar */}
        <Box
          sx={{
            height: 56, px: 3, flexShrink: 0,
            display: "flex", alignItems: "center", gap: 2,
            borderBottom: "1px solid #21262d",
            bgcolor: "#161b22",
          }}
        >
          <Tooltip title="Back to Missions">
            <IconButton
              size="small"
              onClick={() => navigate("/missions")}
              sx={{ color: "#8b949e", "&:hover": { color: "#cdd9e5" } }}
            >
              <ArrowBackIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
          <DroneIcon sx={{ fontSize: 20, color: "#1E90FF" }} />
          <Typography sx={{ fontSize: "1rem", fontWeight: 800, letterSpacing: "3px", color: "#fff" }}>
            FLY<Box component="span" sx={{ color: "#1E90FF" }}>HIGH</Box>
          </Typography>
          <Box sx={{ flex: 1 }} />
          <Typography sx={{ fontSize: "0.75rem", color: "#444c56", letterSpacing: "0.06em", textTransform: "uppercase" }}>
            Dashboard
          </Typography>
        </Box>

        {/* Content */}
        <Box sx={{ flex: 1, px: { xs: 2, md: 4 }, py: 3, maxWidth: 1400, width: "100%", mx: "auto", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 3 }}>

          {/* Page title */}
          <Box>
            <Typography sx={{ fontSize: "1.25rem", fontWeight: 700, color: "#cdd9e5", mb: 0.25 }}>
              Analytics
            </Typography>
            <Typography sx={{ fontSize: "0.75rem", color: "#444c56" }}>
              Overview of all saved missions
            </Typography>
          </Box>

          {error && (
            <Alert severity="error" sx={{ bgcolor: "rgba(248,81,73,0.08)", border: "1px solid rgba(248,81,73,0.3)", color: "#f85149" }}>
              {error}
            </Alert>
          )}

          {loading ? (
            <Box sx={{ display: "flex", justifyContent: "center", mt: 8 }}>
              <CircularProgress size={32} sx={{ color: "#1E90FF" }} />
            </Box>
          ) : (

            <>
              {/* Stats row */}
              <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap" }}>

                {/* 1 — Missions by status */}
                <StatCard label="Missions by status">
                  <DonutChart segments={statusSegments} />
                </StatCard>

                {/* 2 — Total area surveyed */}
                <StatCard label="Area surveyed">
                  <Typography sx={{ fontSize: "1.6rem", fontWeight: 700, color: "#cdd9e5", lineHeight: 1.1 }}>
                    {formatArea(stats?.total_area_m2 ?? 0)}
                  </Typography>
                  <Typography sx={{ fontSize: "0.72rem", color: "#8b949e", mt: 0.5 }}>
                    across {stats?.missions_with_area ?? 0} mission{stats?.missions_with_area !== 1 ? "s" : ""}
                  </Typography>
                </StatCard>

                {/* 3 — Estimated flight hours */}
                <StatCard label="Estimated flight time">
                  <Typography sx={{ fontSize: "1.6rem", fontWeight: 700, color: "#cdd9e5", lineHeight: 1.1 }}>
                    {(stats?.estimated_flight_hours ?? 0).toFixed(1)} hrs
                  </Typography>
                  <Typography sx={{ fontSize: "0.72rem", color: "#8b949e", mt: 0.5 }}>
                    total across all missions
                  </Typography>
                </StatCard>

                {/* 4 — Most used preset */}
                <StatCard label="Most used drone">
                  {stats?.most_used_preset ? (
                    <>
                      <Typography sx={{ fontSize: "1.1rem", fontWeight: 700, color: "#cdd9e5", lineHeight: 1.2 }}>
                        {stats.most_used_preset}
                      </Typography>
                      <Typography sx={{ fontSize: "0.72rem", color: "#8b949e", mt: 0.5 }}>
                        most frequently used preset
                      </Typography>
                    </>
                  ) : (
                    <Typography sx={{ fontSize: "1rem", color: "#444c56" }}>—</Typography>
                  )}
                </StatCard>

                {/* 5 — Recent activity */}
                <StatCard label="Recent activity">
                  {!stats?.recent_activity.length ? (
                    <Typography sx={{ fontSize: "0.78rem", color: "#444c56" }}>No missions yet</Typography>
                  ) : (
                    <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
                      {stats.recent_activity.map((m) => (
                        <Box
                          key={m.folder}
                          onClick={() => navigate(`/missions/${m.folder}`)}
                          sx={{
                            display: "flex", alignItems: "center", gap: 1,
                            cursor: "pointer", py: 0.5,
                            borderRadius: 1,
                            "&:hover": { bgcolor: "rgba(255,255,255,0.03)" },
                          }}
                        >
                          <StatusBadge status={m.status} />
                          <Typography
                            sx={{
                              fontSize: "0.75rem", color: "#cdd9e5", flex: 1,
                              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                            }}
                          >
                            {m.name}
                          </Typography>
                          <Typography sx={{ fontSize: "0.65rem", color: "#444c56", flexShrink: 0 }}>
                            {relativeDate(m.updated_at)}
                          </Typography>
                        </Box>
                      ))}
                    </Box>
                  )}
                </StatCard>
              </Box>

              {/* Global map */}
              <Box
                sx={{
                  bgcolor: "#161b22",
                  border: "1px solid #21262d",
                  borderRadius: 2,
                  overflow: "hidden",
                }}
              >
                {/* Map toolbar */}
                <Box
                  sx={{
                    px: 2, py: 1.25,
                    display: "flex", alignItems: "center", gap: 1.5,
                    borderBottom: "1px solid #21262d",
                  }}
                >
                  <Typography sx={{ fontSize: "0.72rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#444c56", flex: 1 }}>
                    Mission Locations · {validPins.length} pinned
                  </Typography>

                </Box>

                <Box sx={{ height: 420 }}>
                  <MapContainer
                    center={defaultCenter}
                    zoom={validPins.length > 0 ? 5 : 3}
                    style={{ width: "100%", height: "100%" }}
                    zoomControl
                  >
                    <TileLayer
                      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    />

                    <MapFitBounds pins={validPins} />

                    {validPins.map((pin) => (
                      <CircleMarker
                        key={pin.folder}
                        center={[pin.lat!, pin.lon!]}
                        radius={8}
                        pathOptions={{
                          color: STATUS_COLOR[pin.status as MissionStatus] ?? STATUS_COLOR.draft,
                          fillColor: STATUS_COLOR[pin.status as MissionStatus] ?? STATUS_COLOR.draft,
                          fillOpacity: 0.85,
                          weight: 2,
                        }}
                      >
                        <Popup>
                          <Box sx={{ minWidth: 180, p: 0.5 }}>
                            <Typography sx={{ fontSize: "0.85rem", fontWeight: 700, color: "#cdd9e5", mb: 0.75 }}>
                              {pin.name}
                            </Typography>
                            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.75 }}>
                              <StatusBadge status={pin.status as MissionStatus} />
                              <Typography sx={{ fontSize: "0.65rem", color: "#8b949e" }}>
                                {new Date(pin.created_at).toLocaleDateString()}
                              </Typography>
                            </Box>
                            <Box
                              onClick={() => navigate(`/missions/${pin.folder}`)}
                              sx={{
                                display: "flex", alignItems: "center", gap: 0.5,
                                cursor: "pointer",
                                fontSize: "0.72rem", color: "#1E90FF",
                                "&:hover": { textDecoration: "underline" },
                              }}
                            >
                              <OpenInNewIcon sx={{ fontSize: 12 }} />
                              Open mission
                            </Box>
                          </Box>
                        </Popup>
                      </CircleMarker>
                    ))}

                  </MapContainer>
                </Box>
              </Box>
            </>
          )}
        </Box>
      </Box>
    </ThemeProvider>
  );
}
