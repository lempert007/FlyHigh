import React from "react";
import { Box, IconButton, Tab, Tabs, Tooltip } from "@mui/material";
import HelpOutlineIcon from "@mui/icons-material/HelpOutline";

export type TabBadge = "ready" | "warning" | "loading" | "done" | "none";

export interface SidebarTab {
  label: string;
  badge?: TabBadge;
  content: React.ReactNode;
}

interface SidebarShellProps {
  tabs: SidebarTab[];
  activeTab: number;
  onTabChange: (tab: number) => void;
  onTourStart?: () => void;
  tourActive?: boolean;
}

function BadgeDot({ badge }: { badge: TabBadge }) {
  if (badge === "none" || !badge) return null;
  const color =
    badge === "ready" || badge === "done"
      ? "#00e676"
      : badge === "warning"
      ? "#ff9100"
      : "#1E90FF"; // loading
  return (
    <Box
      component="span"
      sx={{
        display: "inline-block",
        width: 6,
        height: 6,
        borderRadius: "50%",
        bgcolor: color,
        ml: 0.75,
        mb: "1px",
        flexShrink: 0,
        ...(badge === "loading" && {
          animation: "badgePulse 1.4s ease-in-out infinite",
          "@keyframes badgePulse": {
            "0%, 100%": { opacity: 1 },
            "50%": { opacity: 0.25 },
          },
        }),
      }}
    />
  );
}

/** 800 px fixed-width sidebar with tabbed panels. */
export function SidebarShell({ tabs, activeTab, onTabChange, onTourStart, tourActive }: SidebarShellProps) {
  return (
    <Box
      sx={{
        width: 800,
        flexShrink: 0,
        bgcolor: "#0d1117",
        borderRight: "1px solid #21262d",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
      }}
    >
      {/* Tab bar */}
      <Box sx={{ borderBottom: "1px solid #21262d", flexShrink: 0, bgcolor: "#0f1318" }}>
        <Tabs
          value={activeTab}
          onChange={(_, v: number) => onTabChange(v)}
          variant="fullWidth"
          sx={{
            minHeight: 44,
            "& .MuiTab-root": {
              minHeight: 44,
              fontSize: "0.68rem",
              fontWeight: 700,
              letterSpacing: "0.09em",
              textTransform: "uppercase",
              color: "text.disabled",
              "&.Mui-selected": { color: "primary.main" },
              "& .MuiTab-iconWrapper": { mb: 0 },
            },
            "& .MuiTabs-indicator": {
              height: 2,
              bgcolor: "primary.main",
              borderRadius: "2px 2px 0 0",
            },
          }}
        >
          {tabs.map((tab, i) => (
            <Tab
              key={i}
              label={
                <Box sx={{ display: "flex", alignItems: "center" }}>
                  {tab.label}
                  <BadgeDot badge={tab.badge ?? "none"} />
                </Box>
              }
            />
          ))}
        </Tabs>
      </Box>

      {/* Tab panels */}
      {tabs.map((tab, i) => (
        <Box
          key={i}
          role="tabpanel"
          hidden={activeTab !== i}
          sx={{
            flex: 1,
            overflowY: "auto",
            display: activeTab === i ? "flex" : "none",
            flexDirection: "column",
            p: 1.5,
            gap: 1.5,
          }}
        >
          {activeTab === i && tab.content}
        </Box>
      ))}

      {/* Footer: tour button */}
      {onTourStart && (
        <Box sx={{ borderTop: "1px solid #21262d", px: 1.5, py: 1, flexShrink: 0 }}>
          <Tooltip title="Take a tour" placement="right">
            <IconButton
              onClick={onTourStart}
              size="small"
              sx={{
                color: tourActive ? "#1E90FF" : "text.disabled",
                bgcolor: tourActive ? "rgba(30,144,255,0.1)" : "transparent",
                border: "1px solid",
                borderColor: tourActive ? "rgba(30,144,255,0.35)" : "#21262d",
                "&:hover": { bgcolor: "rgba(30,144,255,0.12)", borderColor: "rgba(30,144,255,0.35)", color: "#1E90FF" },
              }}
            >
              <HelpOutlineIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      )}
    </Box>
  );
}
