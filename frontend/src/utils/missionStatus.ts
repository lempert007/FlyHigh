import type { MissionStatus } from "../types/mission";

export const STATUS_LABEL: Record<MissionStatus, string> = {
  draft: "Draft",
  ready: "Ready",
  flown: "Flown",
};

export const STATUS_COLOR: Record<MissionStatus, string> = {
  draft: "#8b949e",
  ready: "#3fb950",
  flown: "#1E90FF",
};

export const STATUS_BG: Record<MissionStatus, string> = {
  draft: "rgba(139,148,158,0.1)",
  ready: "rgba(63,185,80,0.12)",
  flown: "rgba(30,144,255,0.12)",
};

export const STATUS_ACCENT: Record<MissionStatus, string> = {
  draft: "#30363d",
  ready: "#238636",
  flown: "#1E90FF",
};
