import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  CssBaseline,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  Menu,
  MenuItem,
  Skeleton,
  TextField,
  ThemeProvider,
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import SearchIcon from "@mui/icons-material/Search";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import DroneIcon from "../components/DroneIcon";
import DashboardIcon from "@mui/icons-material/Dashboard";
import SettingsIcon from "@mui/icons-material/Settings";
import { listMissions, createMission, deleteMission } from "../api";
import type { MissionSummary, MissionStatus, RoutePreview } from "../types/mission";
import { appTheme } from "../theme";
import { GlobalSettingsPanel } from "../components/GlobalSettingsPanel";
import { relativeDate } from "../utils/math";
import { STATUS_LABEL, STATUS_COLOR, STATUS_BG, STATUS_ACCENT } from "../utils/missionStatus";

type FilterStatus = "all" | MissionStatus;

// ── Sub-components ────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: MissionStatus }) {
  const color = STATUS_COLOR[status] ?? STATUS_COLOR.draft;
  const bg = STATUS_BG[status] ?? STATUS_BG.draft;
  const label = STATUS_LABEL[status] ?? STATUS_LABEL.draft;
  return (
    <Box
      sx={{
        display: "inline-flex",
        alignItems: "center",
        px: 1,
        py: 0.25,
        borderRadius: "999px",
        bgcolor: bg,
        border: `1px solid ${color}33`,
        fontSize: "0.65rem",
        fontWeight: 700,
        letterSpacing: "0.05em",
        textTransform: "uppercase",
        color,
        lineHeight: 1.6,
      }}
    >
      {label}
    </Box>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Box
      onClick={onClick}
      sx={{
        px: 1.5,
        py: 0.5,
        borderRadius: "999px",
        cursor: "pointer",
        fontSize: "0.72rem",
        fontWeight: 600,
        letterSpacing: "0.03em",
        userSelect: "none",
        transition: "all 0.15s",
        border: "1px solid",
        borderColor: active ? "#1E90FF" : "#21262d",
        bgcolor: active ? "rgba(30,144,255,0.12)" : "transparent",
        color: active ? "#1E90FF" : "#8b949e",
        "&:hover": {
          borderColor: active ? "#1E90FF" : "#444c56",
          color: active ? "#1E90FF" : "#cdd9e5",
        },
      }}
    >
      {label}
    </Box>
  );
}

function CardMenu({ folder, onDelete }: { folder: string; onDelete: (f: string) => void }) {
  const [anchor, setAnchor] = useState<null | HTMLElement>(null);
  return (
    <>
      <IconButton
        size="small"
        onClick={(e) => {
          e.stopPropagation();
          setAnchor(e.currentTarget);
        }}
        sx={{ color: "#444c56", "&:hover": { color: "#8b949e" }, p: 0.5 }}
      >
        <MoreVertIcon sx={{ fontSize: 16 }} />
      </IconButton>
      <Menu
        anchorEl={anchor}
        open={!!anchor}
        onClose={() => setAnchor(null)}
        PaperProps={{
          sx: {
            bgcolor: "#161b22",
            border: "1px solid #21262d",
            boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
            minWidth: 140,
          },
        }}
      >
        <MenuItem
          onClick={() => {
            setAnchor(null);
            if (window.confirm("Delete this mission? This cannot be undone.")) onDelete(folder);
          }}
          sx={{
            fontSize: "0.8rem",
            color: "#f85149",
            "&:hover": { bgcolor: "rgba(248,81,73,0.08)" },
          }}
        >
          Delete mission
        </MenuItem>
      </Menu>
    </>
  );
}

// ── Route thumbnail SVG ───────────────────────────────────────────────────────

const SVG_W = 400,
  SVG_H = 150,
  PAD = 18;

function RouteThumbnail({ preview }: { preview: RoutePreview | null | undefined }) {
  const allPts = [
    ...(preview?.start ? [preview.start] : []),
    ...(preview?.waypoints ?? []),
    ...(preview?.pois ?? []),
  ];

  const placeholder = (
    <svg
      viewBox={`0 0 ${SVG_W} ${SVG_H}`}
      style={{ width: "100%", height: "100%", display: "block" }}
    >
      <rect width={SVG_W} height={SVG_H} fill="#0d1117" />
      <ellipse
        cx={SVG_W / 2}
        cy={SVG_H / 2}
        rx={80}
        ry={40}
        fill="none"
        stroke="#1E90FF"
        strokeWidth="1"
        strokeOpacity="0.08"
      />
      {/* Drone placeholder icon centred in the thumbnail */}
      <g
        transform={`translate(${SVG_W / 2 - 22}, ${SVG_H / 2 - 22}) scale(1.83)`}
        stroke="#1E90FF"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.12"
      >
        <line x1="9.5" y1="9.5" x2="5" y2="5" strokeWidth="1.6" />
        <line x1="14.5" y1="9.5" x2="19" y2="5" strokeWidth="1.6" />
        <line x1="9.5" y1="14.5" x2="5" y2="19" strokeWidth="1.6" />
        <line x1="14.5" y1="14.5" x2="19" y2="19" strokeWidth="1.6" />
        <rect x="9.5" y="9.5" width="5" height="5" rx="1.2" strokeWidth="1.6" />
        <circle cx="4" cy="4" r="2.4" strokeWidth="1.5" />
        <circle cx="20" cy="4" r="2.4" strokeWidth="1.5" />
        <circle cx="4" cy="20" r="2.4" strokeWidth="1.5" />
        <circle cx="20" cy="20" r="2.4" strokeWidth="1.5" />
        <circle cx="12" cy="12" r="1.1" strokeWidth="1.2" />
      </g>
    </svg>
  );

  if (allPts.length === 0) return placeholder;

  const lats = allPts.map((p) => p.lat);
  const lons = allPts.map((p) => p.lon);
  const minLat = Math.min(...lats),
    maxLat = Math.max(...lats);
  const minLon = Math.min(...lons),
    maxLon = Math.max(...lons);

  const latSpan = maxLat - minLat || 0.005;
  const lonSpan = maxLon - minLon || 0.005;
  const usableW = SVG_W - PAD * 2;
  const usableH = SVG_H - PAD * 2;
  const scale = Math.min(usableW / lonSpan, usableH / latSpan);
  const offsetX = (usableW - lonSpan * scale) / 2;
  const offsetY = (usableH - latSpan * scale) / 2;
  const toX = (lon: number) => PAD + offsetX + (lon - minLon) * scale;
  const toY = (lat: number) => PAD + offsetY + (maxLat - lat) * scale;

  const wps = preview?.waypoints ?? [];
  const routeD =
    wps.length > 1
      ? `M ${wps.map((p) => `${toX(p.lon).toFixed(1)},${toY(p.lat).toFixed(1)}`).join(" L ")}`
      : null;

  return (
    <svg
      viewBox={`0 0 ${SVG_W} ${SVG_H}`}
      style={{ width: "100%", height: "100%", display: "block" }}
    >
      <rect width={SVG_W} height={SVG_H} fill="#0d1117" />

      {/* Glow line (wider, transparent) */}
      {routeD && (
        <path
          d={routeD}
          fill="none"
          stroke="#1E90FF"
          strokeWidth="6"
          strokeOpacity="0.18"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {/* Route line */}
      {routeD && (
        <path
          d={routeD}
          fill="none"
          stroke="#4fc3f7"
          strokeWidth="1.8"
          strokeOpacity="0.85"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}

      {/* Waypoints */}
      {wps.map((p, i) => (
        <circle key={i} cx={toX(p.lon)} cy={toY(p.lat)} r="3" fill="#4fc3f7" opacity="0.8" />
      ))}

      {/* POIs */}
      {(preview?.pois ?? []).map((p, i) => {
        const x = toX(p.lon),
          y = toY(p.lat);
        return (
          <rect
            key={i}
            x={x - 4}
            y={y - 4}
            width="8"
            height="8"
            rx="1.5"
            fill="#ff9800"
            opacity="0.9"
          />
        );
      })}

      {/* Start */}
      {preview?.start && (
        <circle
          cx={toX(preview.start.lon)}
          cy={toY(preview.start.lat)}
          r="5"
          fill="#ef5350"
          opacity="0.95"
        />
      )}
    </svg>
  );
}

function MissionCard({
  mission,
  onOpen,
  onDelete,
}: {
  mission: MissionSummary;
  onOpen: (folder: string) => void;
  onDelete: (folder: string) => void;
}) {
  const accent = STATUS_ACCENT[mission.status as MissionStatus] ?? "#30363d";

  return (
    <Box
      sx={{
        bgcolor: "#161b22",
        border: "1px solid #21262d",
        borderTop: `2px solid ${accent}`,
        borderRadius: 2,
        overflow: "hidden",
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        transition: "border-color 0.18s, box-shadow 0.18s, transform 0.18s",
        "&:hover": {
          borderColor: "#1E90FF44",
          borderTopColor: accent,
          boxShadow: `0 0 0 1px #1E90FF22, 0 8px 32px rgba(0,0,0,0.4)`,
          transform: "translateY(-2px)",
        },
        "&:active": { transform: "translateY(0)" },
      }}
      onClick={() => onOpen(mission.folder)}
    >
      {/* Route thumbnail */}
      <Box sx={{ height: 130, bgcolor: "#0d1117", overflow: "hidden", flexShrink: 0 }}>
        <RouteThumbnail preview={mission.route_preview} />
      </Box>

      {/* Body */}
      <Box sx={{ p: 1.5, flex: 1, display: "flex", flexDirection: "column", gap: 0.5 }}>
        <Typography
          sx={{
            fontSize: "0.85rem",
            fontWeight: 600,
            color: "#cdd9e5",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {mission.name}
        </Typography>
        <Typography sx={{ fontSize: "0.7rem", color: "#444c56" }}>
          {relativeDate(mission.updated_at)}
        </Typography>
      </Box>

      {/* Footer */}
      <Box
        sx={{
          px: 1.5,
          pb: 1.25,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <StatusBadge status={mission.status as MissionStatus} />
        <CardMenu folder={mission.folder} onDelete={onDelete} />
      </Box>
    </Box>
  );
}

function CardSkeleton() {
  return (
    <Box
      sx={{ bgcolor: "#161b22", border: "1px solid #21262d", borderRadius: 2, overflow: "hidden" }}
    >
      <Skeleton variant="rectangular" height={130} sx={{ bgcolor: "#21262d" }} />
      <Box sx={{ p: 1.5 }}>
        <Skeleton variant="text" width="65%" sx={{ bgcolor: "#21262d", mb: 0.5 }} />
        <Skeleton variant="text" width="40%" sx={{ bgcolor: "#21262d" }} />
      </Box>
    </Box>
  );
}

function EmptyState({ hasSearch, onCreate }: { hasSearch: boolean; onCreate: () => void }) {
  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        mt: 10,
        gap: 2,
      }}
    >
      <Box sx={{ position: "relative", mb: 1 }}>
        <Box
          sx={{
            width: 72,
            height: 72,
            borderRadius: "50%",
            bgcolor: "rgba(30,144,255,0.07)",
            border: "1px solid rgba(30,144,255,0.15)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <DroneIcon sx={{ fontSize: 32, color: "#1E90FF", opacity: 0.5 }} />
        </Box>
      </Box>
      <Typography sx={{ fontSize: "0.95rem", fontWeight: 600, color: "#8b949e" }}>
        {hasSearch ? "No matching missions" : "No missions yet"}
      </Typography>
      {!hasSearch && (
        <Typography sx={{ fontSize: "0.78rem", color: "#444c56", mb: 1 }}>
          Create your first mission to get started.
        </Typography>
      )}
      {!hasSearch && (
        <Button
          variant="outlined"
          size="small"
          startIcon={<AddIcon />}
          onClick={onCreate}
          sx={{
            textTransform: "none",
            borderColor: "#21262d",
            color: "#8b949e",
            "&:hover": {
              borderColor: "#1E90FF",
              color: "#1E90FF",
              bgcolor: "rgba(30,144,255,0.06)",
            },
          }}
        >
          New Mission
        </Button>
      )}
    </Box>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function MissionsPage() {
  const navigate = useNavigate();
  const [missions, setMissions] = useState<MissionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterStatus>("all");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setMissions(await listMissions());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleDelete = useCallback(async (folder: string) => {
    try {
      await deleteMission(folder);
      setMissions((prev) => prev.filter((m) => m.folder !== folder));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete mission.");
    }
  }, []);

  const openDialog = useCallback(() => {
    setNewName("");
    setCreateError(null);
    setDialogOpen(true);
  }, []);

  const handleCreate = useCallback(async () => {
    if (!newName.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      const { folder } = await createMission(newName.trim());
      setDialogOpen(false);
      navigate(`/missions/${folder}`);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create mission.");
    } finally {
      setCreating(false);
    }
  }, [newName, navigate]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return missions.filter(
      (m) => m.name.toLowerCase().includes(q) && (filter === "all" || m.status === filter)
    );
  }, [missions, search, filter]);

  const filters: { value: FilterStatus; label: string }[] = [
    { value: "all", label: "All" },
    { value: "draft", label: "Draft" },
    { value: "ready", label: "Ready" },
    { value: "flown", label: "Flown" },
  ];

  return (
    <ThemeProvider theme={appTheme}>
      <CssBaseline />
      <Box
        sx={{
          minHeight: "100vh",
          bgcolor: "background.default",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Top bar */}
        <Box
          sx={{
            height: 56,
            px: 4,
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            gap: 2,
            borderBottom: "1px solid #21262d",
            bgcolor: "#161b22",
          }}
        >
          <DroneIcon sx={{ fontSize: 20, color: "#1E90FF", mr: 0.5 }} />
          <Typography
            sx={{ fontSize: "1rem", fontWeight: 800, letterSpacing: "3px", color: "#fff" }}
          >
            FLY
            <Box component="span" sx={{ color: "#1E90FF" }}>
              HIGH
            </Box>
          </Typography>
          <Box sx={{ flex: 1 }} />
          <Tooltip title="Dashboard">
            <IconButton
              size="small"
              onClick={() => navigate("/dashboard")}
              sx={{ color: "#8b949e", "&:hover": { color: "#1E90FF" }, mr: 0.5 }}
            >
              <DashboardIcon sx={{ fontSize: 20 }} />
            </IconButton>
          </Tooltip>
          <Tooltip title="Settings">
            <IconButton
              size="small"
              onClick={() => setSettingsOpen(true)}
              sx={{ color: "#8b949e", "&:hover": { color: "#cdd9e5" }, mr: 1.5 }}
            >
              <SettingsIcon sx={{ fontSize: 20 }} />
            </IconButton>
          </Tooltip>
          <Button
            variant="contained"
            size="small"
            startIcon={<AddIcon />}
            onClick={openDialog}
            sx={{
              textTransform: "none",
              fontWeight: 600,
              fontSize: "0.8rem",
              px: 2,
              py: 0.75,
              boxShadow: "0 0 16px rgba(30,144,255,0.2)",
              "&:hover": { boxShadow: "0 0 24px rgba(30,144,255,0.35)" },
            }}
          >
            New Mission
          </Button>
        </Box>

        {/* Content */}
        <Box
          sx={{
            flex: 1,
            px: 4,
            py: 3,
            maxWidth: 1400,
            width: "100%",
            mx: "auto",
            boxSizing: "border-box",
          }}
        >
          {/* Page title */}
          <Box sx={{ mb: 3 }}>
            <Typography sx={{ fontSize: "1.25rem", fontWeight: 700, color: "#cdd9e5", mb: 0.25 }}>
              Missions
            </Typography>
            {!loading && (
              <Typography sx={{ fontSize: "0.75rem", color: "#444c56" }}>
                {missions.length} mission{missions.length !== 1 ? "s" : ""}
              </Typography>
            )}
          </Box>

          {/* Search + filters */}
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 3, flexWrap: "wrap" }}>
            <TextField
              size="small"
              placeholder="Search…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon sx={{ fontSize: 16, color: "#444c56" }} />
                  </InputAdornment>
                ),
              }}
              sx={{
                width: 220,
                "& .MuiOutlinedInput-root": {
                  bgcolor: "#0d1117",
                  fontSize: "0.8rem",
                  "& fieldset": { borderColor: "#21262d" },
                  "&:hover fieldset": { borderColor: "#444c56" },
                  "&.Mui-focused fieldset": { borderColor: "#1E90FF" },
                },
              }}
            />
            <Box sx={{ display: "flex", gap: 0.75 }}>
              {filters.map((f) => (
                <FilterChip
                  key={f.value}
                  label={f.label}
                  active={filter === f.value}
                  onClick={() => setFilter(f.value)}
                />
              ))}
            </Box>
          </Box>

          {/* Error */}
          {error && (
            <Alert
              severity="error"
              sx={{
                mb: 2,
                bgcolor: "rgba(248,81,73,0.08)",
                border: "1px solid rgba(248,81,73,0.3)",
                color: "#f85149",
              }}
              onClose={() => setError(null)}
            >
              {error}
            </Alert>
          )}

          {/* Grid */}
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
              gap: 2,
            }}
          >
            {loading
              ? Array.from({ length: 6 }).map((_, i) => <CardSkeleton key={i} />)
              : filtered.map((m) => (
                  <MissionCard
                    key={m.folder}
                    mission={m}
                    onOpen={(f) => navigate(`/missions/${f}`)}
                    onDelete={handleDelete}
                  />
                ))}
          </Box>

          {!loading && filtered.length === 0 && (
            <EmptyState hasSearch={search.length > 0 || filter !== "all"} onCreate={openDialog} />
          )}
        </Box>
      </Box>

      {/* Global settings panel */}
      <GlobalSettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      {/* New Mission dialog */}
      <Dialog
        open={dialogOpen}
        onClose={() => !creating && setDialogOpen(false)}
        maxWidth="xs"
        fullWidth
        PaperProps={{
          sx: {
            bgcolor: "#161b22",
            border: "1px solid #21262d",
            boxShadow: "0 24px 64px rgba(0,0,0,0.7)",
            borderRadius: 2,
          },
        }}
      >
        <DialogTitle sx={{ pb: 1, fontSize: "0.95rem", fontWeight: 700, color: "#cdd9e5" }}>
          New Mission
        </DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            placeholder="Mission name…"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            disabled={creating}
            size="small"
            sx={{
              mt: 0.5,
              "& .MuiOutlinedInput-root": {
                bgcolor: "#0d1117",
                "& fieldset": { borderColor: "#21262d" },
                "&:hover fieldset": { borderColor: "#444c56" },
                "&.Mui-focused fieldset": { borderColor: "#1E90FF" },
              },
            }}
          />
          {createError && (
            <Alert
              severity="error"
              sx={{
                mt: 1.5,
                py: 0.5,
                bgcolor: "rgba(248,81,73,0.08)",
                border: "1px solid rgba(248,81,73,0.2)",
                color: "#f85149",
                fontSize: "0.78rem",
              }}
            >
              {createError}
            </Alert>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5, gap: 1 }}>
          <Button
            onClick={() => setDialogOpen(false)}
            disabled={creating}
            size="small"
            sx={{ textTransform: "none", color: "#8b949e", "&:hover": { color: "#cdd9e5" } }}
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            size="small"
            onClick={handleCreate}
            disabled={creating || !newName.trim()}
            startIcon={creating ? <CircularProgress size={12} color="inherit" /> : undefined}
            sx={{
              textTransform: "none",
              fontWeight: 600,
              boxShadow: "none",
              "&:hover": { boxShadow: "0 0 12px rgba(30,144,255,0.3)" },
            }}
          >
            {creating ? "Creating…" : "Create"}
          </Button>
        </DialogActions>
      </Dialog>
    </ThemeProvider>
  );
}
